"""Pre-sliced Snapshot context per specialist (ADR 0003) + the citation key space.

Each specialist's initial thesis sees a small keyed slice, not the raw Snapshot:
Fundamentals gets flattened statement line items, Technicals gets derived price
metrics, Sentiment gets the cached news items. Grounding (grounding.py) resolves
numeric citation_keys against the SAME deterministically-derived key space, so a
value either matches the slice the agent saw or fails the gate.
"""

from dataclasses import dataclass, field
from statistics import mean

from .snapshot import NewsItem, Snapshot


def fundamentals_slice(snapshot: Snapshot) -> dict[str, float]:
    f = snapshot.fundamentals
    if f is None:
        return {}
    keyed = {f"income_stmt.{k}": v for k, v in f.income_stmt.items()}
    keyed.update({f"balance_sheet.{k}": v for k, v in f.balance_sheet.items()})
    return keyed


def technicals_slice(snapshot: Snapshot) -> dict[str, float]:
    closes = [b.close for b in snapshot.prices]
    volumes = [b.volume for b in snapshot.prices]
    if not closes:
        return {}
    m: dict[str, float] = {"close_latest": closes[-1]}

    def ret(days: int) -> float | None:
        return closes[-1] / closes[-1 - days] - 1 if len(closes) > days else None

    for label, days in (("return_5d", 5), ("return_1m", 21), ("return_3m", 63), ("return_6m", 126)):
        r = ret(days)
        if r is not None:
            m[label] = r
    for window in (20, 50, 200):
        if len(closes) >= window:
            sma = mean(closes[-window:])
            m[f"sma_{window}"] = sma
            m[f"pct_vs_sma_{window}"] = closes[-1] / sma - 1
    m["high_52w"] = max(closes)
    m["low_52w"] = min(closes)
    m["pct_vs_high_52w"] = closes[-1] / max(closes) - 1
    if len(volumes) >= 20:
        avg20 = mean(volumes[-20:])
        m["volume_avg_20"] = avg20
        m["volume_latest_vs_avg_20"] = volumes[-1] / avg20 - 1
    return {f"technicals.{k}": round(v, 6) for k, v in m.items()}


@dataclass
class RunContext:
    """Everything a run derives from its Snapshot, computed once."""

    snapshot: Snapshot
    fundamentals: dict[str, float] = field(init=False)
    technicals: dict[str, float] = field(init=False)
    news: list[NewsItem] = field(init=False)
    numeric_keys: dict[str, float] = field(init=False)  # grounding key space
    sources: dict[str, NewsItem] = field(init=False)

    def __post_init__(self) -> None:
        self.fundamentals = fundamentals_slice(self.snapshot)
        self.technicals = technicals_slice(self.snapshot)
        self.news = self.snapshot.news
        self.numeric_keys = {**self.fundamentals, **self.technicals}
        self.sources = {n.source_id: n for n in self.news}
