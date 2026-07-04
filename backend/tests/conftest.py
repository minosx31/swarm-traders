import json
import os
import tempfile
from pathlib import Path

import httpx
import pytest

os.environ["EVENT_DELAY_S"] = "0"  # no inter-event delay in tests

# Whitelist one (ticker, as_of) pair for the app-level tests: the whitelist is
# the set of snapshot files on disk, so drop a minimal valid snapshot there.
_snapshot_dir = Path(tempfile.mkdtemp(prefix="snapshots-"))
os.environ["SNAPSHOT_DIR"] = str(_snapshot_dir)
os.environ["RUNS_DIR"] = str(Path(tempfile.mkdtemp(prefix="runs-")))  # don't pollute data/runs

WHITELISTED = {"ticker": "NVDA", "as_of": "2026-06-30"}
(_snapshot_dir / "NVDA_2026-06-30.json").write_text(json.dumps({
    "ticker": "NVDA",
    "as_of": "2026-06-30",
    "prices": [{"date": "2026-06-29", "open": 100, "high": 101, "low": 99,
                "close": 100.5, "volume": 1000, "available_at": "2026-06-29"}],
    "fundamentals": {"period_end": "2026-03-31", "available_at": "2026-05-15",
                     "income_stmt": {"Total Revenue": 1.0}, "balance_sheet": {}},
    "news": [{"source_id": "news-001", "title": "t", "summary": "s",
              "published_at": "2026-06-28", "available_at": "2026-06-28"}],
}))


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def collect_sse_events(app, params: dict) -> tuple[int, list[dict]]:
    """GET /stream against the ASGI app; return (status, parsed events)."""
    events = []
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream("GET", "/stream", params=params, timeout=30) as resp:
            if resp.status_code != 200:
                await resp.aread()
                return resp.status_code, []
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    events.append(json.loads(line[len("data:"):].strip()))
    return 200, events
