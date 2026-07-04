"""FastAPI app: GET /stream?ticker&as_of — the SSE live-debate feed.

Also serves the small UI-facing reads: the whitelist (so the frontend can offer
valid pairs) and the Outcome (revealed only after the Verdict — ADR 0002; it
never touches the run path). replay=1 re-streams the latest recorded run
through the same endpoint with the graph bypassed (#9).
"""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from .llm import validate_backend
from .replay import has_recording, stream_replay
from .runner import stream_run
from .snapshot import is_whitelisted, list_whitelisted, load_outcome


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_backend()  # unknown LLM_BACKEND fails fast at startup
    yield


app = FastAPI(title="Alpha Swarms", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/stream")
async def stream(ticker: str, as_of: str, replay: bool = False):
    if replay:
        if not has_recording(ticker, as_of):
            raise HTTPException(status_code=400,
                                detail=f"no recorded run for ({ticker}, {as_of})")
        source = stream_replay(ticker, as_of)
    else:
        # Refused before any streaming, LLM call, or live fetch (ADR 0002).
        if not is_whitelisted(ticker, as_of):
            raise HTTPException(
                status_code=400,
                detail=f"({ticker}, {as_of}) is not a whitelisted snapshot — "
                       "uncached pairs are refused, never live-fetched",
            )
        source = stream_run(ticker, as_of)

    async def sse_events():
        async for event in source:
            yield {"data": json.dumps(event)}

    return EventSourceResponse(sse_events())


@app.get("/whitelist")
async def whitelist():
    return list_whitelisted()


@app.get("/outcome")
async def outcome(ticker: str, as_of: str):
    data = load_outcome(ticker, as_of)
    if data is None:
        raise HTTPException(status_code=404, detail=f"no outcome for ({ticker}, {as_of})")
    return data
