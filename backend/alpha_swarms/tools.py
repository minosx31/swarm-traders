"""Debate-phase tool-calling over the cached Snapshot (issue #8, ADR 0003).

Three read tools — get_financials, get_price_history, get_news — bound to the
Red-Team and Rebuttal nodes only (initial theses stay pre-sliced). Each reads
ONLY the run's cached Snapshot and re-applies the As-Of filter *inside* the tool,
so a tool can never surface a datum dated after the As-Of Date: leakage is
impossible by construction, not by prompt. The read tools return data keyed in
the SAME citation-key space the grounding gate resolves against (slices.py), so
evidence a challenger digs up still flows through the deterministic gate.

Plus the terminal submit_attack / submit_rebuttal tools whose *argument schema is
the exit Pydantic model* (ADR 0005: with_structured_output coercion is itself a
forced tool call and collides with real tools, so tool-using nodes exit by
calling submit_* instead). The tool NAME is the class name, so these are lower
snake_case classes by design.

The whole increment is gated behind DEBATE_TOOLS: unset reproduces the #6
pre-sliced baseline unchanged (the ADR 0003 graceful fallback).
"""

import os
from datetime import date

from langchain_core.tools import tool

from .models import Rebuttal, RedTeamReport
from .slices import RunContext, fundamentals_slice, technicals_slice
from .snapshot import Snapshot

MAX_TOOL_ITERS = 3  # per tool-using node; keeps a full run ~10-12 calls, under the 15 breaker


def debate_tools_enabled() -> bool:
    """The ADR 0003 increment flag. Off by default → pre-sliced #6 baseline."""
    return os.environ.get("DEBATE_TOOLS", "").strip().lower() in ("1", "true", "yes", "on")


# --- as-of-filtered readers (the leakage-by-construction property lives here) ---


def financials_at(snapshot: Snapshot, as_of: date) -> dict[str, float]:
    """Last reported statement line items, only if filed on or before as_of."""
    f = snapshot.fundamentals
    if f is None or f.available_at > as_of:
        return {}
    return fundamentals_slice(snapshot)


def prices_at(snapshot: Snapshot, as_of: date) -> dict[str, float]:
    """Derived price/momentum/volume metrics over bars available by as_of."""
    bars = [b for b in snapshot.prices if b.available_at <= as_of]
    if not bars:
        return {}
    return technicals_slice(snapshot.model_copy(update={"prices": bars}))


def news_at(snapshot: Snapshot, as_of: date) -> list[dict]:
    """Cached headlines published on or before as_of; source_id is citable."""
    return [
        {"source_id": n.source_id, "title": n.title, "summary": n.summary,
         "published_at": n.published_at.isoformat()}
        for n in snapshot.news
        if n.available_at <= as_of
    ]


def make_read_tools(ctx: RunContext) -> list:
    """Per-run read tools closed over the Snapshot + as_of. as_of is NOT a model
    argument — the model cannot ask for a later date, so it cannot leak."""
    snap = ctx.snapshot
    as_of = snap.as_of

    @tool
    def get_financials() -> dict:
        """Last reported income-statement and balance-sheet line items available as
        of the As-Of date. Returns {citation_key: value} — cite these keys exactly."""
        return financials_at(snap, as_of)

    @tool
    def get_price_history() -> dict:
        """Derived price, momentum and volume metrics as of the As-Of date. Returns
        {citation_key: value} — cite these keys exactly."""
        return prices_at(snap, as_of)

    @tool
    def get_news() -> list:
        """Cached news headlines available as of the As-Of date. Each item carries a
        source_id you may cite, plus title, summary and publish date."""
        return news_at(snap, as_of)

    return [get_financials, get_price_history, get_news]


# --- terminal exit tools: argument schema IS the node's output model ------------


class submit_attack(RedTeamReport):  # noqa: N801 — tool name is the class name
    """Submit your finalized attacks and end your turn. Call this once you have
    gathered the counter-evidence you need via the read tools."""


class submit_rebuttal(Rebuttal):  # noqa: N801 — tool name is the class name
    """Submit your finalized rebuttal — revised stance and response — and end your
    turn. Call this once you have gathered the data you need via the read tools."""
