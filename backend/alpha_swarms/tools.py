"""Tool-calling over the cached Snapshot (issue #8, ADR 0003 + its specialist
extension).

Three read tools — get_financials, get_price_history, get_news — over the run's
cached Snapshot. Each re-applies the As-Of filter *inside* the tool, so a tool can
never surface a datum dated after the As-Of Date: leakage is impossible by
construction, not by prompt. The read tools return data keyed in the SAME
citation-key space the grounding gate resolves against (slices.py), so evidence an
agent digs up still flows through the deterministic gate.

When DEBATE_TOOLS is on the whole debate runs on tools: each **specialist** gets
exactly its own lane's read tool (make_specialist_tools) and researches its
initial thesis autonomously, and the Red-Team and Rebuttal nodes get all three.
A specialist's single-lane tool set preserves lane isolation — it can only fetch,
and therefore only cite, its own lane.

Plus the terminal submit_thesis / submit_attack / submit_rebuttal tools whose
*argument schema is the exit Pydantic model* (ADR 0005: with_structured_output
coercion is itself a forced tool call and collides with real tools, so tool-using
nodes exit by calling submit_* instead). The tool NAME is the class name, so these
are lower snake_case classes by design.

The whole thing is gated behind DEBATE_TOOLS: unset reproduces the #6 pre-sliced
baseline unchanged (the ADR 0003 graceful fallback).
"""

import os
from datetime import date

from langchain_core.tools import tool

from .models import Rebuttal, RedTeamReport, Thesis
from .slices import RunContext, fundamentals_slice, technicals_slice
from .snapshot import Snapshot

MAX_TOOL_ITERS = 3  # per debate node (red-team / rebuttal): all three read tools
SPECIALIST_TOOL_ITERS = 2  # a specialist has one lane tool: one research turn, then submit

# each specialist's single lane tool — fetching only its lane keeps a specialist
# unable to cite outside its lane, the same isolation the pre-sliced path enforces
SPECIALIST_TOOLS = {
    "fundamentals": "get_financials",
    "technicals": "get_price_history",
    "sentiment": "get_news",
}


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


def make_specialist_tools(agent: str, ctx: RunContext) -> list:
    """The one lane read tool a specialist may call. Filters make_read_tools so the
    as_of-closed-over property is identical to the debate tools — a specialist can
    fetch only its lane, so it can only ground (and vote on) its own lane."""
    want = SPECIALIST_TOOLS[agent]
    return [t for t in make_read_tools(ctx) if t.name == want]


# --- terminal exit tools: argument schema IS the node's output model ------------


class submit_thesis(Thesis):  # noqa: N801 — tool name is the class name
    """Submit your finalized thesis — signed stance and cited evidence — and end
    your turn. Call this once you have fetched your lane's data via your read tool."""


class submit_attack(RedTeamReport):  # noqa: N801 — tool name is the class name
    """Submit your finalized attacks and end your turn. Call this once you have
    gathered the counter-evidence you need via the read tools."""


class submit_rebuttal(Rebuttal):  # noqa: N801 — tool name is the class name
    """Submit your finalized rebuttal — revised stance and response — and end your
    turn. Call this once you have gathered the data you need via the read tools."""
