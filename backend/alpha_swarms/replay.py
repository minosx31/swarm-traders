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

from . import llm
from .events import default_delay


def runs_dir() -> Path:
    return Path(os.environ.get("RUNS_DIR", Path(__file__).parent.parent / "data" / "runs"))


def save_run(ticker: str, as_of: str, events: list[dict],
             usage: dict | None = None) -> Path:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    tag = llm.model_tag()  # ticker_asof_MODEL_stamp_pid_hex — run self-identifies its model
    path = runs_dir() / f"{ticker.upper()}_{as_of}_{tag}_{stamp}_{os.getpid()}_{id(events):x}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {"ticker": ticker.upper(), "as_of": as_of, "model": tag,
              "recorded_at": stamp, "events": events}
    if usage is not None:
        record["usage"] = usage  # tokens/calls/cost for cross-run comparison
    path.write_text(json.dumps(record, indent=2))
    return path


def _runs_for(ticker: str, as_of: str) -> list[Path]:
    # by mtime, not name: the model tag now sits before the timestamp, so a
    # lexical name sort would rank by model then time, not strictly by recency.
    return sorted(runs_dir().glob(f"{ticker.upper()}_{as_of}_*.json"),
                  key=lambda p: p.stat().st_mtime)


def latest_run_path(ticker: str, as_of: str) -> Path | None:
    paths = _runs_for(ticker, as_of)
    return paths[-1] if paths else None


def list_runs(ticker: str, as_of: str) -> list[dict]:
    """Recorded runs for a pair, newest first — for the replay 'which run' picker.
    Each carries its model, recorded_at, and usage (tokens/calls/cost, or None for
    runs recorded before usage tracking); `run` is the filename to replay."""
    out = []
    for p in reversed(_runs_for(ticker, as_of)):
        try:
            log = json.loads(p.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        out.append({"run": p.name, "model": log.get("model", "unknown"),
                    "recorded_at": log.get("recorded_at", ""),
                    "usage": log.get("usage")})
    return out


def resolve_run_path(ticker: str, as_of: str, run: str | None) -> Path | None:
    """The specific recorded file to replay: `run` (a bare filename, traversal-safe)
    if given and present, else the latest. None if there is no recording."""
    if run:
        candidate = runs_dir() / Path(run).name  # strip any path components
        return candidate if candidate.is_file() else None
    return latest_run_path(ticker, as_of)


def has_recording(ticker: str, as_of: str) -> bool:
    return latest_run_path(ticker, as_of) is not None


async def stream_replay(ticker: str, as_of: str, *, run: str | None = None,
                        delay: float | None = None):
    """Re-stream a recorded run (the selected one, or the latest). Graph bypassed;
    no LLM, no snapshot."""
    path = resolve_run_path(ticker, as_of, run)
    log = json.loads(path.read_text())
    if delay is None:
        delay = default_delay()
    for event in log["events"]:
        yield event
        if delay:
            await asyncio.sleep(delay)
