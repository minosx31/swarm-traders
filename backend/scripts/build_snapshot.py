"""Offline Snapshot ingestion (ADR 0002). NEVER runs during a request.

Usage:  uv run scripts/build_snapshot.py AAPL 2026-06-30 [--window-days 365] [--outcome-days 30]

Builds data/snapshots/{TICKER}_{AS_OF}.json (prices, last *reported*
fundamentals, news with stable source_ids — every datum stamped and validated
<= as_of) and data/outcomes/{TICKER}_{AS_OF}.json (what happened after; held
out of everything the run path loads).
"""

import argparse
import sys
from datetime import date, datetime, timedelta

import yfinance as yf

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from alpha_swarms.snapshot import (  # noqa: E402
    FILING_LAG_DAYS,
    NewsItem,
    PriceBar,
    ReportedFundamentals,
    Snapshot,
    save_outcome,
    save_snapshot,
    select_reported_period,
    validate_snapshot,
)


def fetch_prices(t: yf.Ticker, start: date, end_inclusive: date) -> list[PriceBar]:
    hist = t.history(start=start.isoformat(), end=(end_inclusive + timedelta(days=1)).isoformat())
    bars = []
    for ts, row in hist.iterrows():
        d = ts.date()
        bars.append(PriceBar(date=d, open=row["Open"], high=row["High"], low=row["Low"],
                             close=row["Close"], volume=int(row["Volume"]), available_at=d))
    return bars


def _statement_items(df, period) -> dict[str, float]:
    col = df[period].dropna()
    return {str(k): float(v) for k, v in col.items()}


def fetch_fundamentals(t: yf.Ticker, as_of: date) -> ReportedFundamentals | None:
    income = t.quarterly_income_stmt
    balance = t.quarterly_balance_sheet
    if income.empty:
        return None
    period_ends = [ts.date() for ts in income.columns]
    period = select_reported_period(period_ends, as_of)
    if period is None:
        return None
    period_ts = next(ts for ts in income.columns if ts.date() == period)
    balance_items = {}
    if not balance.empty and period_ts in balance.columns:
        balance_items = _statement_items(balance, period_ts)
    return ReportedFundamentals(
        period_end=period,
        available_at=period + timedelta(days=FILING_LAG_DAYS),
        income_stmt=_statement_items(income, period_ts),
        balance_sheet=balance_items,
    )


def fetch_news(t: yf.Ticker, as_of: date) -> list[NewsItem]:
    items = []
    for raw in t.news:
        content = raw.get("content") or {}
        pub = content.get("pubDate")
        if not (raw.get("id") and content.get("title") and pub):
            continue
        published = datetime.fromisoformat(pub.replace("Z", "+00:00")).date()
        if published > as_of:
            continue  # hard point-in-time filter
        items.append(NewsItem(source_id=raw["id"], title=content["title"],
                              summary=content.get("summary") or "",
                              published_at=published, available_at=published))
    return items


def build_outcome(t: yf.Ticker, as_of: date, days: int) -> dict:
    hist = t.history(start=(as_of + timedelta(days=1)).isoformat(),
                     end=(as_of + timedelta(days=days + 1)).isoformat())
    return {
        "note": "What actually happened after as_of. NEVER enters agent-visible state (ADR 0002).",
        "as_of": as_of.isoformat(),
        "prices_after": [
            {"date": ts.date().isoformat(), "close": float(row["Close"]), "volume": int(row["Volume"])}
            for ts, row in hist.iterrows()
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ticker")
    ap.add_argument("as_of", type=date.fromisoformat)
    ap.add_argument("--window-days", type=int, default=365)
    ap.add_argument("--outcome-days", type=int, default=30)
    args = ap.parse_args()

    t = yf.Ticker(args.ticker)
    snapshot = Snapshot(
        ticker=args.ticker.upper(),
        as_of=args.as_of,
        prices=fetch_prices(t, args.as_of - timedelta(days=args.window_days), args.as_of),
        fundamentals=fetch_fundamentals(t, args.as_of),
        news=fetch_news(t, args.as_of),
    )
    violations = validate_snapshot(snapshot)
    if violations:
        print("LEAK CHECK FAILED:\n  " + "\n  ".join(violations))
        return 1
    path = save_snapshot(snapshot)
    outcome_path = save_outcome(args.ticker, args.as_of.isoformat(),
                                build_outcome(t, args.as_of, args.outcome_days))
    f = snapshot.fundamentals
    print(f"snapshot  {path}")
    print(f"  prices: {len(snapshot.prices)} bars <= {args.as_of}")
    print(f"  fundamentals: period_end={f.period_end if f else None} "
          f"available_at={f.available_at if f else None}")
    print(f"  news: {len(snapshot.news)} items")
    print(f"  leak check: PASSED (0 violations)")
    print(f"outcome   {outcome_path}  (held out of agent state)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
