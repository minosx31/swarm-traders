"""Snapshot ingestion (ADR 0002, ADR 0006): fetch → validate → save, importable.

Runs offline (CLI) or on demand via POST /snapshots — but always to completion,
leak-checked, *before* any agent runs. News comes from Finnhub (date-ranged
historical, needs FINNHUB_API_KEY) or falls back to yfinance current headlines.
"""

import os
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import yfinance as yf

from .sec_edgar import fetch_edgar_fundamentals
from .snapshot import (
    FILING_LAG_DAYS,
    NewsItem,
    PriceBar,
    ReportedFundamentals,
    Snapshot,
    save_outcome,
    save_snapshot,
    select_reported_period,
)


class IngestError(Exception):
    """A fetch failed or produced no usable data — the pair cannot be snapshotted."""


_SYMBOL_RE = re.compile(r"[A-Z][A-Z.\-]{0,9}")


def check_ticker(ticker: str) -> dict:
    """Cheap existence probe for the NEW PAIR ticker box, so a bad symbol is caught
    before the user commits to a full snapshot build. Returns
    {ticker, valid, name?, reason?} — a plausible-shape gate then a light yfinance
    recent-history lookup (the same source ingest relies on). Never raises."""
    t = ticker.strip().upper()
    if not _SYMBOL_RE.fullmatch(t):
        return {"ticker": t, "valid": False, "reason": "not a plausible ticker symbol"}
    try:
        yft = yf.Ticker(t)
        if yft.history(period="5d").empty:
            return {"ticker": t, "valid": False, "reason": "no market data for that symbol"}
    except Exception:  # noqa: BLE001 — network/parse hiccup ⇒ can't confirm, don't crash
        return {"ticker": t, "valid": False, "reason": "lookup failed — try again"}
    name = None
    try:  # a friendly name is best-effort; .info is heavier and may rate-limit
        info = yft.info or {}
        name = info.get("shortName") or info.get("longName") or None
    except Exception:  # noqa: BLE001
        name = None
    return {"ticker": t, "valid": True, "name": name}


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
        url = (content.get("canonicalUrl") or {}).get("url") or (content.get("clickThroughUrl") or {}).get("url")
        items.append(NewsItem(source_id=raw["id"], title=content["title"],
                              summary=content.get("summary") or "",
                              published_at=published, available_at=published, url=url))
    return items


def finnhub_news_items(payload: list[dict], as_of: date, cap: int = 50) -> list[NewsItem]:
    seen, items = set(), []
    for raw in payload:
        rid, headline, ts = raw.get("id"), raw.get("headline"), raw.get("datetime")
        if not (rid and headline and ts):
            continue
        published = datetime.fromtimestamp(ts, tz=timezone.utc).date()
        if published > as_of:
            continue  # hard point-in-time filter (ADR 0002) even though the API is date-bounded
        sid = f"fh-{rid}"
        if sid in seen:
            continue
        seen.add(sid)
        items.append(NewsItem(source_id=sid, title=headline, summary=raw.get("summary") or "",
                              published_at=published, available_at=published, url=raw.get("url") or None))
    items.sort(key=lambda n: n.published_at, reverse=True)
    return items[:cap]


def fetch_finnhub_news(ticker: str, as_of: date, news_days: int) -> list[NewsItem]:
    frm = (as_of - timedelta(days=news_days)).isoformat()
    try:
        resp = httpx.get("https://finnhub.io/api/v1/company-news",
                         params={"symbol": ticker.upper(), "from": frm, "to": as_of.isoformat(),
                                 "token": os.environ["FINNHUB_API_KEY"]}, timeout=30)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise IngestError(f"Finnhub request failed: {e}") from e
    cap = int(os.environ.get("NEWS_CAP", "50"))
    return finnhub_news_items(resp.json(), as_of, cap)


def build_outcome(t: yf.Ticker, as_of: date, days: int) -> dict:
    hist = t.history(start=(as_of + timedelta(days=1)).isoformat(),
                     end=(as_of + timedelta(days=days + 1)).isoformat())
    return {
        "note": "What actually happened after as_of. NEVER enters agent-visible state (ADR 0002).",
        "as_of": as_of.isoformat(),
        "prices_after": [
            {"date": ts.date().isoformat(), "close": float(row["Close"]), "volume": int(row["Volume"])}
            for ts, row in hist.iterrows()
            if ts.date() > as_of  # yfinance can echo the as_of bar when the window is empty
        ],
    }


def ingest_pair(ticker: str, as_of: date, window_days: int = 365, outcome_days: int = 30,
                news_days: int | None = None) -> tuple[Snapshot, str, Path, Path]:
    """Fetch, leak-check, and persist one (ticker, as_of) pair. Raises IngestError
    on fetch failure / empty data, ValueError if the snapshot would leak.

    News volume is tunable via env: NEWS_DAYS (lookback window, default 30) and
    NEWS_CAP (max items kept, default 50, applied in fetch_finnhub_news)."""
    if news_days is None:
        news_days = int(os.environ.get("NEWS_DAYS", "30"))
    t = yf.Ticker(ticker)
    prices = fetch_prices(t, as_of - timedelta(days=window_days), as_of)
    if not prices:
        raise IngestError(f"no price data for {ticker.upper()} <= {as_of} — bad ticker or date?")
    news_source = "finnhub" if os.environ.get("FINNHUB_API_KEY") else "yfinance"
    news = (fetch_finnhub_news(ticker, as_of, news_days) if news_source == "finnhub"
            else fetch_news(t, as_of))
    # SEC EDGAR (real filing dates, as-reported values) for US tickers; yfinance
    # otherwise or if EDGAR is unreachable — same graceful-fallback shape as news.
    try:
        fundamentals = fetch_edgar_fundamentals(ticker, as_of)
    except httpx.HTTPError:
        fundamentals = None  # EDGAR down / rate-limited → fall through to yfinance
    if fundamentals is not None:
        fundamentals_source = "sec-edgar"
    else:
        fundamentals, fundamentals_source = fetch_fundamentals(t, as_of), "yfinance"
    snapshot = Snapshot(ticker=ticker.upper(), as_of=as_of, prices=prices,
                        fundamentals=fundamentals, news=news,
                        provenance={"prices": "yfinance",
                                    "fundamentals": fundamentals_source, "news": news_source})
    path = save_snapshot(snapshot)  # refuses to save a leaky snapshot
    outcome_path = save_outcome(ticker, as_of.isoformat(), build_outcome(t, as_of, outcome_days))
    return snapshot, news_source, path, outcome_path
