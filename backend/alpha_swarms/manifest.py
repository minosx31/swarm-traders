"""Read-only snapshot manifest for the UI (ADR 0002 companion) — shows exactly
what data the agents were fed, without changing what they were fed. Built from
the same slices (slices.py) and leak check (snapshot.py) the run path already
uses, never a re-derivation, so the manifest can't drift from the ground truth.
"""

from .slices import fundamentals_slice, technicals_slice
from .snapshot import Snapshot, validate_snapshot

YAHOO_QUOTE_URL = "https://finance.yahoo.com/quote/{ticker}"


def build_manifest(snapshot: Snapshot) -> dict:
    prices = snapshot.prices
    f = snapshot.fundamentals

    return {
        "ticker": snapshot.ticker,
        "as_of": snapshot.as_of.isoformat(),
        "prices": {
            "bars": len(prices),
            "first_date": prices[0].date.isoformat() if prices else None,
            "last_date": prices[-1].date.isoformat() if prices else None,
            "source_url": f"{YAHOO_QUOTE_URL.format(ticker=snapshot.ticker)}/history",
        },
        "fundamentals": None if f is None else {
            "period_end": f.period_end.isoformat(),
            "available_at": f.available_at.isoformat(),
            "source_url": f"{YAHOO_QUOTE_URL.format(ticker=snapshot.ticker)}/financials",
            "keys": fundamentals_slice(snapshot),
        },
        "technicals": {
            "keys": technicals_slice(snapshot),
        },
        "news": [
            {
                "source_id": item.source_id,
                "title": item.title,
                "published_at": item.published_at.isoformat(),
                "url": item.url,
            }
            for item in snapshot.news
        ],
        "leak_check": {
            "violations": validate_snapshot(snapshot),
        },
    }
