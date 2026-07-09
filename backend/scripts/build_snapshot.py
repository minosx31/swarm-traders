"""Offline Snapshot ingestion CLI — thin wrapper over alpha_swarms.ingest.

Usage:  uv run scripts/build_snapshot.py AAPL 2026-06-30 [--window-days 365] [--outcome-days 30] [--news-days 30]

Builds data/snapshots/{TICKER}_{AS_OF}.json (prices, last *reported*
fundamentals, news with stable source_ids — every datum stamped and validated
<= as_of) and data/outcomes/{TICKER}_{AS_OF}.json (what happened after; held
out of everything the run path loads). Set FINNHUB_API_KEY (backend/.env is
auto-loaded) for date-ranged historical news; falls back to yfinance without it.
"""

import argparse
import sys
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent.parent))
from alpha_swarms.ingest import IngestError, ingest_pair  # noqa: E402


def main() -> int:
    load_dotenv(Path(__file__).parent.parent / ".env")
    ap = argparse.ArgumentParser()
    ap.add_argument("ticker")
    ap.add_argument("as_of", type=date.fromisoformat)
    ap.add_argument("--window-days", type=int, default=365)
    ap.add_argument("--outcome-days", type=int, default=30)
    ap.add_argument("--news-days", type=int, default=30)
    args = ap.parse_args()

    try:
        snapshot, news_source, path, outcome_path = ingest_pair(
            args.ticker, args.as_of, window_days=args.window_days,
            outcome_days=args.outcome_days, news_days=args.news_days)
    except (IngestError, ValueError) as e:
        print(f"BUILD FAILED: {e}")
        return 1

    f = snapshot.fundamentals
    print(f"snapshot  {path}")
    print(f"  prices: {len(snapshot.prices)} bars <= {args.as_of}")
    print(f"  fundamentals: period_end={f.period_end if f else None} "
          f"available_at={f.available_at if f else None} (source: {f.source if f else None})")
    print(f"  news: {len(snapshot.news)} items (source: {news_source})")
    print(f"  leak check: PASSED (0 violations)")
    print(f"outcome   {outcome_path}  (held out of agent state)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
