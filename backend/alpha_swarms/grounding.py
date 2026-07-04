"""Deterministic grounding validator + gate (ADR 0001, CONTEXT.md).

Two symmetric tiers, pure functions of (evidence, RunContext):
- numeric: citation_key must resolve in the run's key space AND cited_value must
  match within tolerance
- textual: source_id must resolve to a real cached source (hard gate); an exact
  substring quoted_span earns the Verified Quote badge (a badge, not a gate)

Ungrounded items are dropped before scoring. A lens needs >= 1 grounded item to
earn a vote. Red-Team counter-evidence is held to the same bar.
"""

import math

from .models import Evidence, NumericEvidence, TextualEvidence
from .slices import RunContext

VALUE_TOLERANCE_REL = 0.01  # cited_value within 1% of the slice value


def ground_item(item: Evidence, ctx: RunContext) -> dict:
    """Annotate one evidence item with its deterministic gate result."""
    out = item.model_dump()
    if isinstance(item, NumericEvidence):
        actual = ctx.numeric_keys.get(item.citation_key)
        if actual is None:
            out.update(grounded=False, reason="citation_key not in snapshot")
        elif not math.isclose(item.cited_value, actual, rel_tol=VALUE_TOLERANCE_REL, abs_tol=1e-9):
            out.update(grounded=False, reason=f"cited_value {item.cited_value} != snapshot {actual}")
        else:
            out.update(grounded=True)
    elif isinstance(item, TextualEvidence):
        source = ctx.sources.get(item.source_id)
        if source is None:
            out.update(grounded=False, reason="source_id not in snapshot")
        else:
            out.update(grounded=True, url=source.url,
                       verified_quote=item.quoted_span in f"{source.title} {source.summary}")
    return out


def ground_evidence(items: list[Evidence], ctx: RunContext) -> tuple[list[dict], list[dict]]:
    """Returns (all items annotated — for display, and the grounded subset — for scoring)."""
    annotated = [ground_item(item, ctx) for item in items]
    return annotated, [a for a in annotated if a["grounded"]]


def earns_vote(grounded: list[dict]) -> bool:
    """The gate: >= 1 Grounded Evidence item to vote. A gate, not a weight."""
    return len(grounded) >= 1
