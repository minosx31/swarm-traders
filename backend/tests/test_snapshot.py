"""Issue #3 acceptance: point-in-time integrity, whitelist refusal, Outcome held out."""

from datetime import date, datetime, timezone
from pathlib import Path

import httpx
import pytest

from alpha_swarms.app import app
from alpha_swarms.ingest import IngestError, finnhub_news_items
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


def _fh(as_of: date) -> int:
    return int(datetime(as_of.year, as_of.month, as_of.day, tzinfo=timezone.utc).timestamp())


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


def test_finnhub_mapping_filters_dedupes_and_skips_incomplete():
    payload = [
        {"id": 1, "headline": "valid", "summary": "s", "datetime": _fh(date(2026, 6, 20))},
        {"id": 2, "headline": "future", "summary": "", "datetime": _fh(date(2026, 7, 2))},
        {"id": 1, "headline": "dup", "summary": "", "datetime": _fh(date(2026, 6, 19))},
        {"id": 3, "headline": "", "summary": "", "datetime": _fh(date(2026, 6, 18))},
        {"headline": "no id", "datetime": _fh(date(2026, 6, 17))},
        {"id": 5, "headline": "no datetime"},
    ]
    items = finnhub_news_items(payload, AS_OF)
    assert [n.source_id for n in items] == ["fh-1"]
    assert items[0].title == "valid" and items[0].summary == "s"
    assert items[0].published_at == date(2026, 6, 20)


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


# --- on-demand snapshot build at POST /snapshots (ADR 0006) -----------------------


async def _post_snapshots(params: dict) -> tuple[int, dict]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post("/snapshots", params=params)
        return resp.status_code, resp.json()


async def test_build_endpoint_builds_missing_pair_then_reuses(monkeypatch):
    from alpha_swarms import app as app_module

    calls = []

    def fake_ingest(ticker, as_of, **kwargs):
        calls.append(ticker)
        save_snapshot(make_snapshot(ticker=ticker.upper(), as_of=as_of))

    monkeypatch.setattr(app_module, "ingest_pair", fake_ingest)
    status, body = await _post_snapshots({"ticker": "AAPL", "as_of": "2026-06-30"})
    assert (status, body["built"]) == (200, True)
    status, body = await _post_snapshots({"ticker": "AAPL", "as_of": "2026-06-30"})
    assert (status, body["built"]) == (200, False)
    assert calls == ["AAPL"]  # snapshot on disk is reused, never re-fetched


async def test_build_endpoint_surfaces_failure_as_400(monkeypatch):
    from alpha_swarms import app as app_module

    def failing_ingest(ticker, as_of, **kwargs):
        raise IngestError("no price data for BAD <= 2026-06-30 — bad ticker or date?")

    monkeypatch.setattr(app_module, "ingest_pair", failing_ingest)
    status, body = await _post_snapshots({"ticker": "BAD", "as_of": "2026-06-30"})
    assert status == 400 and "no price data" in body["detail"]

    status, _ = await _post_snapshots({"ticker": "AAPL", "as_of": "not-a-date"})
    assert status == 400  # malformed as_of never reaches a fetch


async def test_whitelisted_pair_streams(monkeypatch):
    from alpha_swarms import llm
    from tests import fakes

    model = fakes.ScriptedChatModel(script=fakes.full_debate_script())
    monkeypatch.setattr(llm, "get_chat_model", lambda: model)
    status, events = await collect_sse_events(app, WHITELISTED)
    assert status == 200
    assert events[-1]["type"] == "verdict"
