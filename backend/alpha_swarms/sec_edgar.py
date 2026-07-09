"""SEC EDGAR fundamentals source (ADR 0002): authoritative, point-in-time, free.

For US tickers, replaces yfinance's *restated* numbers + the 45-day filing-lag
*guess* with data pulled straight from SEC XBRL: the real 10-Q/10-K filing date
for `available_at`, and *as-reported* values — the value from the earliest filing
for a period, before any later restatement. Every fact carries its own `filed`
date, so the As-Of point-in-time gate (ADR 0002) is applied here, at the source.

Non-US tickers (SGX, etc.) have no EDGAR CIK, so `fetch_edgar_fundamentals`
returns None and the caller (ingest.py) falls back to the yfinance path.

One `companyfacts` request per ticker returns every concept at once; we index it
locally rather than firing a request per line item.
"""

import os
from datetime import date

import httpx

from .snapshot import ReportedFundamentals

_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
_TIMEOUT = 30
_FORMS = {"10-Q", "10-K"}

# friendly citation key -> ordered us-gaap concept aliases (first present wins).
# Aliases absorb cross-company tag variance (e.g. AMZN/AAPL tag revenue as
# RevenueFromContractWithCustomerExcludingAssessedTax; others use Revenues).
_INCOME = [
    ("revenue", ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"]),
    ("cost_of_revenue", ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"]),
    ("gross_profit", ["GrossProfit"]),
    ("rd_expense", ["ResearchAndDevelopmentExpense"]),
    ("sga_expense", ["SellingGeneralAndAdministrativeExpense"]),
    ("operating_expenses", ["OperatingExpenses", "CostsAndExpenses"]),
    ("operating_income", ["OperatingIncomeLoss"]),
    ("interest_expense", ["InterestExpense", "InterestExpenseNonoperating"]),
    ("income_tax", ["IncomeTaxExpenseBenefit"]),
    ("net_income", ["NetIncomeLoss", "ProfitLoss"]),
]
_INCOME_PER_SHARE = [
    ("eps_basic", ["EarningsPerShareBasic"]),
    ("eps_diluted", ["EarningsPerShareDiluted"]),
]
_BALANCE = [
    ("total_assets", ["Assets"]),
    ("current_assets", ["AssetsCurrent"]),
    ("cash_and_equivalents", ["CashAndCashEquivalentsAtCarryingValue",
                              "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]),
    ("total_liabilities", ["Liabilities"]),
    ("current_liabilities", ["LiabilitiesCurrent"]),
    ("long_term_debt", ["LongTermDebtNoncurrent", "LongTermDebt"]),
    ("stockholders_equity", ["StockholdersEquity",
                             "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]),
    ("retained_earnings", ["RetainedEarningsAccumulatedDeficit"]),
    ("inventory", ["InventoryNet"]),
    ("accounts_receivable", ["AccountsReceivableNetCurrent"]),
    ("accounts_payable", ["AccountsPayableCurrent"]),
    ("goodwill", ["Goodwill"]),
]
_ANCHOR = "Assets"  # universally reported balance-sheet item; anchors period selection

_cik_cache: dict[str, str] = {}


def _headers() -> dict:
    # SEC asks callers to self-identify; read at call time so env/.env is honoured.
    ua = os.environ.get("SEC_EDGAR_USER_AGENT", "swarm-traders (you@example.com)")
    return {"User-Agent": ua, "Accept-Encoding": "gzip, deflate"}


def _get(url: str) -> dict:
    resp = httpx.get(url, headers=_headers(), timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def ticker_to_cik(ticker: str) -> str | None:
    """Zero-padded 10-digit CIK for a US ticker, or None if not SEC-listed."""
    if not _cik_cache:
        for row in _get(_TICKERS_URL).values():
            _cik_cache[row["ticker"].upper()] = f"{int(row['cik_str']):010d}"
    return _cik_cache.get(ticker.upper())


def _unit_list(usgaap: dict, concept: str, unit: str) -> list[dict]:
    return usgaap.get(concept, {}).get("units", {}).get(unit, [])


def _pick(facts: list[dict], period_end: date, as_of: date, duration: bool) -> dict | None:
    """The fact for `period_end` visible by `as_of`. Duration (income) items keep
    the shortest span (a single quarter, not YTD); all ties break to the earliest
    `filed` — the as-reported value before any restatement."""
    cands = [f for f in facts
             if _d(f.get("end")) == period_end and f.get("form") in _FORMS and _d(f["filed"]) <= as_of]
    if duration:
        cands = [f for f in cands if f.get("start")]
        if not cands:
            return None
        return min(cands, key=lambda f: ((period_end - _d(f["start"])).days, _d(f["filed"])))
    if not cands:
        return None
    return min(cands, key=lambda f: _d(f["filed"]))


def _collect(usgaap: dict, concepts: list, unit: str, period_end: date, as_of: date,
             duration: bool, used_filed: list[date]) -> dict[str, float]:
    out: dict[str, float] = {}
    for key, aliases in concepts:
        for alias in aliases:
            fact = _pick(_unit_list(usgaap, alias, unit), period_end, as_of, duration)
            if fact is not None:
                out[key] = float(fact["val"])
                used_filed.append(_d(fact["filed"]))
                break
    return out


def fetch_edgar_fundamentals(ticker: str, as_of: date) -> ReportedFundamentals | None:
    """Last statement filed on or before `as_of`, as-reported, from SEC XBRL.
    Returns None for non-US tickers or when no filing is available by `as_of`
    (the caller then falls back to yfinance). Network errors propagate."""
    cik = ticker_to_cik(ticker)
    if cik is None:
        return None
    usgaap = _get(_FACTS_URL.format(cik=cik)).get("facts", {}).get("us-gaap", {})
    if not usgaap:
        return None

    # Anchor the reporting period on the latest Assets filing visible by as_of.
    ends = [_d(f["end"]) for f in _unit_list(usgaap, _ANCHOR, "USD")
            if f.get("form") in _FORMS and _d(f["filed"]) <= as_of]
    if not ends:
        return None
    period_end = max(ends)

    used_filed: list[date] = []
    income = _collect(usgaap, _INCOME, "USD", period_end, as_of, True, used_filed)
    income.update(_collect(usgaap, _INCOME_PER_SHARE, "USD/shares", period_end, as_of, True, used_filed))
    balance = _collect(usgaap, _BALANCE, "USD", period_end, as_of, False, used_filed)
    if not (income or balance):
        return None

    return ReportedFundamentals(
        period_end=period_end,
        available_at=max(used_filed),  # real filing date; <= as_of by construction
        income_stmt=income,
        balance_sheet=balance,
        source="sec-edgar",
    )
