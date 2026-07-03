"""Display-event channel (ADR 0004).

Node code emits typed display events into a per-run asyncio.Queue; the /stream
endpoint drains it and relays each as an SSE event. Events are plain
JSON-serializable dicts with a "type" key matching the SSE contract
(ARCHITECTURE §3): agent_start, thesis, attack, tool_call, tool_result,
rebuttal, adjudication, verdict — plus the terminal error event.

The deliberate inter-event delay is applied on the *consumer* side (drain),
not in emit(): parallel specialist nodes produce concurrently, so only the
single drain point can guarantee readable spacing on the wire.
"""

import asyncio
import os

_SENTINEL = None


def default_delay() -> float:
    return float(os.environ.get("EVENT_DELAY_S", "0.25"))


class EventEmitter:
    """Per-run event queue. Nodes call emit(); the endpoint drains."""

    def __init__(self) -> None:
        self._queue: asyncio.Queue = asyncio.Queue()

    async def emit(self, event: dict) -> None:
        await self._queue.put(event)

    async def close(self) -> None:
        await self._queue.put(_SENTINEL)

    async def drain(self, delay: float | None = None):
        """Yield events until close(), sleeping `delay` between events."""
        if delay is None:
            delay = default_delay()
        while True:
            event = await self._queue.get()
            if event is _SENTINEL:
                return
            yield event
            if delay:
                await asyncio.sleep(delay)
