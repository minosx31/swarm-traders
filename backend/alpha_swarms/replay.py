"""Record + replay (issue #9, ADR 0004): a recorded run IS its event log.

Every run persists the events exactly as they went over the wire (including a
terminal error event) to data/runs/. Replay re-streams the most recent log for
a (ticker, as_of) through the same /stream endpoint with the graph bypassed —
zero LLM calls, $0. The same artifact feeds the demo video re-shoots and the
static replay site (#11).
"""

import asyncio
import json
import os
import time
from pathlib import Path

from .events import default_delay


def runs_dir() -> Path:
    return Path(os.environ.get("RUNS_DIR", Path(__file__).parent.parent / "data" / "runs"))


def save_run(ticker: str, as_of: str, events: list[dict]) -> Path:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    path = runs_dir() / f"{ticker.upper()}_{as_of}_{stamp}_{os.getpid()}_{id(events):x}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(
        {"ticker": ticker.upper(), "as_of": as_of, "recorded_at": stamp, "events": events},
        indent=2))
    return path


def latest_run_path(ticker: str, as_of: str) -> Path | None:
    paths = sorted(runs_dir().glob(f"{ticker.upper()}_{as_of}_*.json"))
    return paths[-1] if paths else None


def has_recording(ticker: str, as_of: str) -> bool:
    return latest_run_path(ticker, as_of) is not None


async def stream_replay(ticker: str, as_of: str, *, delay: float | None = None):
    """Re-stream the latest recorded run. Graph bypassed; no LLM, no snapshot."""
    log = json.loads(latest_run_path(ticker, as_of).read_text())
    if delay is None:
        delay = default_delay()
    for event in log["events"]:
        yield event
        if delay:
            await asyncio.sleep(delay)
