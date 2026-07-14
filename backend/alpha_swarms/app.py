"""FastAPI app: GET /stream?ticker&as_of — the SSE live-debate feed.

Also serves the small UI-facing reads: the whitelist (so the frontend can offer
valid pairs), the Outcome (revealed only after the Verdict — ADR 0002; it
never touches the run path), and the Snapshot manifest (exactly what data the
agents were fed). replay=1 re-streams the latest recorded run through the same
endpoint with the graph bypassed (#9).
"""

import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from .ingest import IngestError, check_ticker, ingest_pair
from .llm import BACKENDS, available_models, validate_backend
from .manifest import build_manifest
from .replay import list_runs, resolve_run_path, stream_replay
from .runner import stream_run
from .snapshot import is_whitelisted, list_whitelisted, load_outcome, load_snapshot

load_dotenv(Path(__file__).parent.parent / ".env")  # FINNHUB_API_KEY, provider keys, …


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_backend()  # unknown LLM_BACKEND fails fast at startup
    yield


app = FastAPI(title="Alpha Swarms", lifespan=lifespan)

# Comma-separated origins allowed to call the API. Defaults to the Vite dev
# server; set ALLOWED_ORIGINS on the host (Render) to the deployed frontend origin.
_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/stream")
async def stream(ticker: str, as_of: str, replay: bool = False,
                 backend: str | None = None, model: str | None = None,
                 run: str | None = None):
    if replay:
        # `run` selects a specific recording (which model's run); else the latest.
        if resolve_run_path(ticker, as_of, run) is None:
            raise HTTPException(status_code=400,
                                detail=f"no recorded run for ({ticker}, {as_of})")
        source = stream_replay(ticker, as_of, run=run)
    else:
        if backend is not None and backend not in BACKENDS:
            raise HTTPException(status_code=400, detail=f"unknown backend {backend!r}")
        # Refused before any streaming, LLM call, or live fetch (ADR 0002).
        if not is_whitelisted(ticker, as_of):
            raise HTTPException(
                status_code=400,
                detail=f"({ticker}, {as_of}) is not a whitelisted snapshot — "
                       "uncached pairs are refused, never live-fetched",
            )
        source = stream_run(ticker, as_of, backend=backend, model=model)

    async def sse_events():
        async for event in source:
            yield {"data": json.dumps(event)}

    return EventSourceResponse(sse_events())


@app.post("/snapshots")
async def build_snapshot(ticker: str, as_of: str):
    """Build-if-missing (ADR 0006): the snapshot is fetched, leak-checked, and on
    disk before any run can start; an existing pair is reused, never re-fetched."""
    if is_whitelisted(ticker, as_of):
        return {"ticker": ticker.upper(), "as_of": as_of, "built": False}
    try:
        await asyncio.to_thread(ingest_pair, ticker, date.fromisoformat(as_of))
    except (IngestError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ticker": ticker.upper(), "as_of": as_of, "built": True}


@app.get("/validate-ticker")
async def validate_ticker(ticker: str):
    """Does this symbol exist? Lets the NEW PAIR box tell the user before they
    commit to a snapshot build. Always 200 with {valid, ...}; a bad symbol is a
    normal answer, not an error."""
    return await asyncio.to_thread(check_ticker, ticker)


@app.get("/whitelist")
async def whitelist():
    return list_whitelisted()


@app.get("/models")
async def models():
    """Selectable (backend, model) options for the UI — installed Ollama models
    plus the paid Claude options when ANTHROPIC_API_KEY is configured."""
    return available_models()


@app.get("/runs")
async def runs(ticker: str, as_of: str):
    """Recorded runs for a pair (newest first) so replay can pick one by model."""
    return list_runs(ticker, as_of)


@app.get("/outcome")
async def outcome(ticker: str, as_of: str):
    data = load_outcome(ticker, as_of)
    if data is None:
        raise HTTPException(status_code=404, detail=f"no outcome for ({ticker}, {as_of})")
    return data


@app.get("/snapshot")
async def snapshot(ticker: str, as_of: str):
    """The manifest of exactly what data the agents were fed — same slices and
    leak check the run path uses, never a re-derivation."""
    if not is_whitelisted(ticker, as_of):
        raise HTTPException(
            status_code=404,
            detail=f"({ticker}, {as_of}) is not a whitelisted snapshot",
        )
    return build_manifest(load_snapshot(ticker, as_of))
