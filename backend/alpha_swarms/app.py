"""FastAPI app: GET /stream?ticker&as_of — the SSE live-debate feed."""

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from sse_starlette.sse import EventSourceResponse

from .llm import validate_backend
from .runner import stream_run
from .snapshot import is_whitelisted


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_backend()  # unknown LLM_BACKEND fails fast at startup
    yield


app = FastAPI(title="Alpha Swarms", lifespan=lifespan)


@app.get("/stream")
async def stream(ticker: str, as_of: str):
    # Refused before any streaming, LLM call, or live fetch (ADR 0002).
    if not is_whitelisted(ticker, as_of):
        raise HTTPException(
            status_code=400,
            detail=f"({ticker}, {as_of}) is not a whitelisted snapshot — "
                   "uncached pairs are refused, never live-fetched",
        )

    async def sse_events():
        async for event in stream_run(ticker, as_of):
            yield {"data": json.dumps(event)}

    return EventSourceResponse(sse_events())
