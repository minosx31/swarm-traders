"""Snapshot manifest: the read-only UI view of exactly what data agents were fed."""

from datetime import date

import httpx

from alpha_swarms.app import app
from alpha_swarms.manifest import build_manifest
from alpha_swarms.slices import fundamentals_slice, technicals_slice
from alpha_swarms.snapshot import NewsItem, PriceBar, ReportedFundamentals, Snapshot
from tests.conftest import WHITELISTED

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
                       published_at=date(2026, 6, 28), available_at=date(2026, 6, 28),
                       url="https://example.com/n1")],
    )
    return Snapshot(**{**base, **overrides})


# --- shape & key-space fidelity ------------------------------------------------


def test_manifest_key_spaces_match_slices():
    snapshot = make_snapshot()
    manifest = build_manifest(snapshot)
    assert manifest["fundamentals"]["keys"] == fundamentals_slice(snapshot)
    assert manifest["technicals"]["keys"] == technicals_slice(snapshot)


def test_fundamentals_is_null_when_snapshot_has_none():
    manifest = build_manifest(make_snapshot(fundamentals=None))
    assert manifest["fundamentals"] is None


def test_dates_are_iso_strings():
    manifest = build_manifest(make_snapshot())
    assert manifest["as_of"] == "2026-06-30"
    assert manifest["prices"]["first_date"] == "2026-06-29"
    assert manifest["prices"]["last_date"] == "2026-06-29"
    assert manifest["fundamentals"]["period_end"] == "2026-03-31"
    assert manifest["fundamentals"]["available_at"] == "2026-05-15"
    assert manifest["news"][0]["published_at"] == "2026-06-28"


def test_prices_bars_and_dates_from_bar_range():
    prices = [
        PriceBar(date=date(2026, 6, 1), open=1, high=1, low=1, close=1,
                 volume=1, available_at=date(2026, 6, 1)),
        PriceBar(date=date(2026, 6, 29), open=1, high=1, low=1, close=1,
                 volume=1, available_at=date(2026, 6, 29)),
    ]
    manifest = build_manifest(make_snapshot(prices=prices))
    assert manifest["prices"]["bars"] == 2
    assert manifest["prices"]["first_date"] == "2026-06-01"
    assert manifest["prices"]["last_date"] == "2026-06-29"


def test_empty_prices_yields_zero_bars_and_null_dates():
    manifest = build_manifest(make_snapshot(prices=[]))
    assert manifest["prices"]["bars"] == 0
    assert manifest["prices"]["first_date"] is None
    assert manifest["prices"]["last_date"] is None


def test_news_mirrors_snapshot_news():
    manifest = build_manifest(make_snapshot())
    assert manifest["news"] == [{
        "source_id": "n1", "title": "t", "published_at": "2026-06-28",
        "url": "https://example.com/n1",
    }]


def test_news_url_may_be_none():
    snapshot = make_snapshot(news=[NewsItem(source_id="n2", title="t", summary="s",
                                            published_at=date(2026, 6, 28),
                                            available_at=date(2026, 6, 28))])
    manifest = build_manifest(snapshot)
    assert manifest["news"][0]["url"] is None


def test_clean_snapshot_has_no_leak_violations():
    manifest = build_manifest(make_snapshot())
    assert manifest["leak_check"]["violations"] == []


# --- GET /snapshot route -------------------------------------------------------


async def _get_snapshot(params: dict) -> tuple[int, dict]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/snapshot", params=params)
        return resp.status_code, resp.json()


async def test_non_whitelisted_pair_404s():
    status, body = await _get_snapshot({"ticker": "TSLA", "as_of": "2026-06-30"})
    assert status == 404
    assert "TSLA" in body["detail"]


async def test_whitelisted_pair_returns_manifest():
    status, body = await _get_snapshot(WHITELISTED)
    assert status == 200
    assert body["ticker"] == WHITELISTED["ticker"]
    assert body["as_of"] == WHITELISTED["as_of"]
