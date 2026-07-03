"""Issue #3 acceptance: point-in-time integrity, whitelist refusal, Outcome held out."""

from datetime import date
from pathlib import Path

import pytest

from alpha_swarms.app import app
from alpha_swarms.snapshot import (
    NewsItem,
    PriceBar,
    ReportedFundamentals,
    Snapshot,
    load_snapshot,
    save_snapshot,
    select_reported_period,
    validate_snapshot,
)
from tests.conftest import WHITELISTED, collect_sse_events

AS_OF = date(2026, 6, 30)


def make_snapshot(**overrides) -> Snapshot:
    base = dict(
        ticker="TEST",
        as_of=AS_OF,
        prices=[PriceBar(date=date(2026, 6, 29), open=1, high=1, low=1, close=1,
                         volume=1, available_at=date(2026, 6, 29))],
        fundamentals=ReportedFundamentals(period_end=date(2026, 3, 31),
                                          available_at=date(2026, 5, 15),
                                          income_stmt={"Total Revenue": 1.0}, balance_sheet={}),
        news=[NewsItem(source_id="n1", title="t", summary="s",
                       published_at=date(2026, 6, 28), available_at=date(2026, 6, 28))],
    )
    return Snapshot(**{**base, **overrides})


# --- leak check ---------------------------------------------------------------


def test_clean_snapshot_passes_leak_check():
    assert validate_snapshot(make_snapshot()) == []


def test_price_after_as_of_is_a_violation():
    leaky = make_snapshot(prices=[PriceBar(date=date(2026, 7, 1), open=1, high=1, low=1,
                                           close=1, volume=1, available_at=date(2026, 7, 1))])
    assert any("price bar" in v for v in validate_snapshot(leaky))


def test_unreported_fundamentals_are_a_violation():
    # Period ended before as_of but not yet FILED by as_of — the silent leak ADR 0002 warns about
    leaky = make_snapshot(fundamentals=ReportedFundamentals(
        period_end=date(2026, 6, 30), available_at=date(2026, 8, 14),
        income_stmt={}, balance_sheet={}))
    assert any("fundamentals" in v for v in validate_snapshot(leaky))


def test_news_after_as_of_is_a_violation():
    leaky = make_snapshot(news=[NewsItem(source_id="n2", title="t", summary="s",
                                         published_at=date(2026, 7, 2),
                                         available_at=date(2026, 7, 2))])
    assert any("news" in v for v in validate_snapshot(leaky))


def test_save_refuses_leaky_snapshot():
    leaky = make_snapshot(prices=[PriceBar(date=date(2026, 7, 1), open=1, high=1, low=1,
                                           close=1, volume=1, available_at=date(2026, 7, 1))])
    with pytest.raises(ValueError, match="leaky"):
        save_snapshot(leaky)


def test_select_reported_period_checks_filing_date_not_period_end():
    period_ends = [date(2025, 12, 31), date(2026, 3, 31), date(2026, 6, 30)]
    # Q2 (6/30) just ended — not filed yet; Q1 (3/31) filed ~5/15 — that's the one
    assert select_reported_period(period_ends, AS_OF) == date(2026, 3, 31)
    # Early April: even Q1 isn't filed yet
    assert select_reported_period(period_ends, date(2026, 4, 10)) == date(2025, 12, 31)
    assert select_reported_period([date(2026, 6, 30)], date(2026, 7, 1)) is None


def test_repo_snapshots_have_no_leaks():
    """Automated check over every snapshot actually committed to data/snapshots."""
    repo_dir = Path(__file__).parent.parent / "data" / "snapshots"
    paths = sorted(repo_dir.glob("*.json"))
    if not paths:
        pytest.skip("no snapshots built yet")
    for path in paths:
        snapshot = Snapshot.model_validate_json(path.read_text())
        assert validate_snapshot(snapshot) == [], f"{path.name} leaks future data"


# --- Outcome separation ---------------------------------------------------------


def test_outcome_is_absent_from_loaded_snapshot():
    snapshot = load_snapshot(**WHITELISTED)
    assert "outcome" not in snapshot.model_dump()
    assert not hasattr(snapshot, "outcome")


# --- whitelist enforcement at /stream ---------------------------------------------


async def test_non_whitelisted_ticker_is_refused_with_400():
    status, events = await collect_sse_events(app, {"ticker": "TSLA", "as_of": "2026-06-30"})
    assert status == 400
    assert events == []


async def test_non_whitelisted_date_is_refused_with_400():
    status, events = await collect_sse_events(app, {"ticker": "NVDA", "as_of": "1999-01-01"})
    assert status == 400
    assert events == []


async def test_whitelisted_pair_streams(monkeypatch):
    from alpha_swarms import llm
    from tests import fakes

    model = fakes.ScriptedChatModel(script=fakes.full_debate_script())
    monkeypatch.setattr(llm, "get_chat_model", lambda: model)
    status, events = await collect_sse_events(app, WHITELISTED)
    assert status == 200
    assert events[-1]["type"] == "verdict"
