"""Run lifecycle: owns the per-run queue and the mid-run error boundary.

The /stream endpoint is the single catch point for a run that raises mid-graph
(ADR 0004) — e.g. the circuit breaker (ADR 0005). The failure surfaces as a
terminal `error` event instead of a dead socket.
"""

import asyncio

from .events import EventEmitter
from .graph import build_graph
from .safeguards import RunSafeguards

_default_graph = None


def get_graph():
    global _default_graph
    if _default_graph is None:
        _default_graph = build_graph()
    return _default_graph


async def stream_run(ticker: str, as_of: str, *, graph=None, delay: float | None = None):
    """Run the debate graph for (ticker, as_of), yielding display events."""
    graph = graph or get_graph()
    emitter = EventEmitter()
    # Attached via the invoke config so it propagates to every nested LLM call —
    # global and un-bypassable by node code (ADR 0005).
    safeguards = RunSafeguards()

    async def _run() -> None:
        state = {"ticker": ticker, "as_of": as_of, "theses": [],
                 "attacks": [], "rebuttals": [], "adjudicated_stances": []}
        config = {"configurable": {"emit": emitter.emit}, "callbacks": [safeguards]}
        try:
            await graph.ainvoke(state, config=config)
        except Exception as exc:  # breaker trips, node crashes — all end here
            await emitter.emit({"type": "error", "error": type(exc).__name__, "message": str(exc)})
        finally:
            safeguards.finish_run()
            await emitter.close()

    run_task = asyncio.create_task(_run())
    try:
        async for event in emitter.drain(delay):
            yield event
    finally:
        run_task.cancel()  # client disconnected mid-run: stop the graph
