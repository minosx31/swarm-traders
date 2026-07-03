"""Point-in-time Snapshot layer (ADR 0002).

A Snapshot is a curated JSON bundle per (ticker, as_of); every datum carries an
`available_at` stamp hard-filtered to <= as_of. The whitelist IS the set of
snapshot files on disk — no separate config to drift. The Outcome lives in
data/outcomes/, which nothing on the run path ever reads.

Fundamentals availability: yfinance exposes period-end dates, not filing dates,
so we stamp period_end + FILING_LAG_DAYS (the 10-Q deadline). Conservative in
the safe direction — may exclude an already-public quarter, can never leak an
unreported one. Demo curation (#10) eyeballs each snapshot regardless.
"""

import json
import os
from datetime import date, timedelta
from pathlib import Path

from pydantic import BaseModel

FILING_LAG_DAYS = 45


class PriceBar(BaseModel):
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: int
    available_at: date  # = trading date


class ReportedFundamentals(BaseModel):
    period_end: date
    available_at: date  # period_end + FILING_LAG_DAYS
    income_stmt: dict[str, float]
    balance_sheet: dict[str, float]


class NewsItem(BaseModel):
    source_id: str  # stable provider id
    title: str
    summary: str
    published_at: date
    available_at: date  # = published_at


class Snapshot(BaseModel):
    ticker: str
    as_of: date
    prices: list[PriceBar]
    fundamentals: ReportedFundamentals | None
    news: list[NewsItem]


def snapshot_dir() -> Path:
    return Path(os.environ.get("SNAPSHOT_DIR", Path(__file__).parent.parent / "data" / "snapshots"))


def outcome_dir() -> Path:
    return snapshot_dir().parent / "outcomes"


def snapshot_path(ticker: str, as_of: str) -> Path:
    return snapshot_dir() / f"{ticker.upper()}_{as_of}.json"


def is_whitelisted(ticker: str, as_of: str) -> bool:
    return snapshot_path(ticker, as_of).is_file()


def load_snapshot(ticker: str, as_of: str) -> Snapshot:
    """The ONLY loader agent-side code may use. Never reads data/outcomes/."""
    return Snapshot.model_validate_json(snapshot_path(ticker, as_of).read_text())


def select_reported_period(period_ends: list[date], as_of: date) -> date | None:
    """Last period whose figures were *reported* (filed) on or before as_of —
    checked by availability date, not period end."""
    reported = [p for p in period_ends if p + timedelta(days=FILING_LAG_DAYS) <= as_of]
    return max(reported) if reported else None


def validate_snapshot(snapshot: Snapshot) -> list[str]:
    """The automated leak check: no datum may be dated after as_of."""
    violations = []
    for bar in snapshot.prices:
        if bar.date > snapshot.as_of or bar.available_at > snapshot.as_of:
            violations.append(f"price bar {bar.date} after as_of {snapshot.as_of}")
    f = snapshot.fundamentals
    if f and f.available_at > snapshot.as_of:
        violations.append(f"fundamentals available {f.available_at} after as_of {snapshot.as_of}")
    for item in snapshot.news:
        if item.published_at > snapshot.as_of or item.available_at > snapshot.as_of:
            violations.append(f"news {item.source_id!r} published {item.published_at} after as_of")
    return violations


def save_snapshot(snapshot: Snapshot) -> Path:
    violations = validate_snapshot(snapshot)
    if violations:
        raise ValueError("refusing to save leaky snapshot: " + "; ".join(violations))
    path = snapshot_path(snapshot.ticker, snapshot.as_of.isoformat())
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(snapshot.model_dump_json(indent=2))
    return path


def save_outcome(ticker: str, as_of: str, outcome: dict) -> Path:
    path = outcome_dir() / f"{ticker.upper()}_{as_of}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(outcome, indent=2, default=str))
    return path
