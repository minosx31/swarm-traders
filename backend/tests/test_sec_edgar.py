"""SEC EDGAR fundamentals: point-in-time filing gate, as-reported values, fallback.

EDGAR is mocked (no network) by monkeypatching sec_edgar._get to serve canned
company_tickers + companyfacts JSON, mirroring the repo's fake-injection style.
"""

from datetime import date

import pytest

from alpha_swarms import sec_edgar

TICKERS = {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}}


def _fact(end, val, filed, start=None, form="10-Q"):
    f = {"end": end, "val": val, "filed": filed, "form": form}
    if start:
        f["start"] = start
    return f


# Two reported quarters. Q1'26 (end 3/31) filed 5/1; Q4'25 (end 12/31) filed 2/1.
# Revenue for Q1 has a YTD fact (500, 6-month) + the quarter (250, 3-month) filed
# together, plus a later *restatement* (260) filed 8/1 — used to prove we take the
# as-reported (earliest-filed) quarterly value, never the YTD or the restatement.
FACTS = {"facts": {"us-gaap": {
    "Assets": {"units": {"USD": [
        _fact("2025-12-31", 900, "2026-02-01"),
        _fact("2026-03-31", 1000, "2026-05-01"),
    ]}},
    "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [
        _fact("2025-12-31", 240, "2026-02-01", start="2025-10-01"),
        _fact("2026-03-31", 500, "2026-05-01", start="2025-10-01"),  # YTD (6mo) — must be ignored
        _fact("2026-03-31", 250, "2026-05-01", start="2026-01-01"),  # quarter (3mo) as-reported
        _fact("2026-03-31", 260, "2026-08-01", start="2026-01-01"),  # restatement — must be ignored
    ]}},
    "NetIncomeLoss": {"units": {"USD": [
        _fact("2025-12-31", 90, "2026-02-01", start="2025-10-01"),
        _fact("2026-03-31", 100, "2026-05-01", start="2026-01-01"),
    ]}},
}}}


@pytest.fixture(autouse=True)
def _mock_edgar(monkeypatch):
    sec_edgar._cik_cache.clear()

    def fake_get(url: str) -> dict:
        if url == sec_edgar._TICKERS_URL:
            return TICKERS
        if "companyfacts" in url:
            return FACTS
        raise AssertionError(f"unexpected EDGAR URL: {url}")

    monkeypatch.setattr(sec_edgar, "_get", fake_get)


def test_picks_latest_quarter_filed_by_as_of():
    f = sec_edgar.fetch_edgar_fundamentals("AAPL", date(2026, 6, 1))
    assert f is not None
    assert f.source == "sec-edgar"
    assert f.period_end == date(2026, 3, 31)
    assert f.available_at == date(2026, 5, 1)  # the real 10-Q filing date, not period_end+45d
    assert f.income_stmt["revenue"] == 250.0   # the 3-month quarter, not the 500 YTD
    assert f.income_stmt["net_income"] == 100.0
    assert f.balance_sheet["total_assets"] == 1000.0


def test_filing_gate_excludes_not_yet_filed_quarter():
    # Mid-April: Q1 (end 3/31) is not filed until 5/1, so the last *visible* filing is Q4'25.
    f = sec_edgar.fetch_edgar_fundamentals("AAPL", date(2026, 4, 15))
    assert f.period_end == date(2025, 12, 31)
    assert f.available_at == date(2026, 2, 1)
    assert f.income_stmt["revenue"] == 240.0


def test_as_reported_ignores_later_restatement():
    # Well after the 8/1 restatement, the value is still the originally-filed 250.
    f = sec_edgar.fetch_edgar_fundamentals("AAPL", date(2026, 12, 1))
    assert f.income_stmt["revenue"] == 250.0


def test_none_when_nothing_filed_yet():
    # Before any filing exists → None so the caller falls back to yfinance.
    assert sec_edgar.fetch_edgar_fundamentals("AAPL", date(2026, 1, 1)) is None


def test_none_for_non_us_ticker():
    # Not in the CIK map (e.g. an SGX symbol) → None → yfinance fallback.
    assert sec_edgar.fetch_edgar_fundamentals("D05.SI", date(2026, 6, 1)) is None
