"""LLM-backed debate nodes (issues #4-#6): specialists, Red-Team, rebuttals, Judge.

All initial-thesis and debate turns are pre-sliced single calls, NO tools
(ADR 0003 baseline; the tool-calling increment is issue #8). Structured output
via .with_structured_output(schema, include_raw=True) with exactly one
validation-retry (ADR 0005). Nodes reach the per-run RunContext and emit()
through config["configurable"]; the chat model comes from llm.get_chat_model()
so tests can swap it.

Budget shape (~8 calls/run): 3 theses + 1 red-team + up to 3 rebuttals + 1 judge.
Non-gated specialists are skipped in the debate — no vote, no calls.
"""

import json

from langchain_core.messages import HumanMessage, SystemMessage

from . import llm
from .grounding import earns_vote, ground_evidence
from .models import JudgeRuling, Rebuttal, RedTeamReport, Thesis
from .scoring import compute_verdict
from .slices import RunContext

SPECIALISTS = ("fundamentals", "sentiment", "technicals")


class StructuredOutputError(RuntimeError):
    """Model output failed schema validation even after the retry."""


async def call_structured(schema, system: str, user: str, config, *, post_validate=None):
    """One LLM call + at most one validation-retry, then fail gracefully."""
    model = llm.get_chat_model().with_structured_output(
        schema, include_raw=True, **llm.structured_output_kwargs())
    messages = [SystemMessage(content=llm.system_content(system)), HumanMessage(content=user)]
    error = None
    for _ in range(2):  # initial attempt + exactly one retry
        result = await model.ainvoke(messages, config=config)
        parsed, error = result.get("parsed"), result.get("parsing_error")
        if parsed is not None and post_validate is not None:
            try:
                post_validate(parsed)
            except ValueError as exc:
                parsed, error = None, exc
        if parsed is not None:
            return parsed
        messages = messages + [HumanMessage(content=(
            f"Your previous output failed validation: {error}. "
            "Respond again with ONLY valid JSON matching the schema."))]
    raise StructuredOutputError(f"{schema.__name__} failed validation after one retry: {error}")


def _configurable(config):
    c = config["configurable"]
    return c["emit"], c["run_context"]


# --- prompt fragments ---------------------------------------------------------

STANCE_RUBRIC = (
    "Stance is one signed number in [-1, +1]: sign is direction (negative=bear, "
    "positive=bull), magnitude is strength. Cite ONLY the data provided below — "
    "every claim needs an exact citation. Fabricated or mis-copied citations are "
    "dropped by a deterministic validator and cost you your vote."
)

SPECIALIST_BRIEFS = {
    "fundamentals": ("You are the fundamentals analyst: valuation, earnings, balance-sheet health. "
                     "Use numeric evidence: cite an exact citation_key and its value."),
    "sentiment": ("You are the sentiment analyst: news flow and narrative. "
                  "Use textual evidence: cite an exact source_id and quote a short verbatim span. "
                  "If no news is provided, say so in your summary and take a stance near 0 "
                  "with an empty evidence list — do NOT invent sources."),
    "technicals": ("You are the technicals analyst: price action, momentum, volume. "
                   "Use numeric evidence: cite an exact citation_key and its value."),
}


def _numeric_block(keyed: dict[str, float]) -> str:
    return "\n".join(f"  {k} = {v}" for k, v in keyed.items()) or "  (none available)"


def _news_block(ctx: RunContext) -> str:
    if not ctx.news:
        return "  (no news available in this snapshot)"
    return "\n".join(f"  source_id={n.source_id} ({n.published_at}) {n.title} — {n.summary}"
                     for n in ctx.news)


def specialist_context(agent: str, ctx: RunContext) -> str:
    s = ctx.snapshot
    head = f"Ticker: {s.ticker} · As-of date: {s.as_of} (you know NOTHING after this date)\n"
    if agent == "fundamentals":
        f = s.fundamentals
        period = f"Last reported quarter: period_end={f.period_end}, filed by {f.available_at}\n" if f else ""
        return head + period + "Data (citation_key = value):\n" + _numeric_block(ctx.fundamentals)
    if agent == "technicals":
        return head + "Data (citation_key = value):\n" + _numeric_block(ctx.technicals)
    return head + "Cached news:\n" + _news_block(ctx)


def _thesis_digest(thesis: dict) -> str:
    ev = "; ".join(f"[{e.get('citation_key') or e.get('source_id')}] {e['claim']}"
                   for e in thesis["grounded_evidence"]) or "no grounded evidence"
    return f"- {thesis['agent']} (stance {thesis['stance']:+.2f}): {thesis['summary']} Evidence: {ev}"


# --- nodes --------------------------------------------------------------------


def make_specialist_node(agent: str):
    async def specialist(state, config) -> dict:
        emit, ctx = _configurable(config)
        await emit({"type": "agent_start", "agent": agent})
        thesis = await call_structured(
            Thesis,
            system=f"{SPECIALIST_BRIEFS[agent]}\n{STANCE_RUBRIC}",
            user=specialist_context(agent, ctx),
            config=config,
        )
        annotated, grounded = ground_evidence(thesis.evidence, ctx)
        gated_in = earns_vote(grounded)
        await emit({"type": "thesis", "agent": agent, "stance": thesis.stance,
                    "summary": thesis.summary, "evidence": annotated})
        await emit({"type": "grounding", "agent": agent, "gated_in": gated_in,
                    "grounded": len(grounded), "dropped": len(annotated) - len(grounded)})
        return {"theses": [{"agent": agent, "stance": thesis.stance, "summary": thesis.summary,
                            "grounded_evidence": grounded, "gated_in": gated_in}]}

    return specialist


async def red_team(state, config) -> dict:
    emit, ctx = _configurable(config)
    gated = [t for t in state["theses"] if t["gated_in"]]
    if not gated:
        return {"attacks": []}
    await emit({"type": "agent_start", "agent": "red_team"})
    digests = "\n".join(_thesis_digest(t) for t in gated)
    report = await call_structured(
        RedTeamReport,
        system=("You are the red-team. Attack each thesis below with its strongest counter-case. "
                "kind='evidence' attacks MUST cite the provided data (same exact-citation rule); "
                "kind='logical' attacks expose an internal flaw (contradiction, over-extrapolation, "
                "ignoring a provided datum) and need no new evidence. Unsupported doubt does not count.\n"
                + STANCE_RUBRIC),
        user=(f"Theses under attack:\n{digests}\n\n"
              f"Data (citation_key = value):\n{_numeric_block(ctx.numeric_keys)}\n\n"
              f"Cached news:\n{_news_block(ctx)}"),
        config=config,
    )
    gated_names = {t["agent"] for t in gated}
    kept = []
    dropped = 0
    for attack in report.attacks:
        if attack.target not in gated_names:
            dropped += 1  # stray target (e.g. a gated-out lens): drop, don't crash
            continue
        annotated, grounded = ground_evidence(attack.counter_evidence, ctx)
        if attack.kind == "evidence" and not grounded:
            dropped += 1  # same bar as the specialists: no grounding, no attack
            continue
        record = {"target": attack.target, "kind": attack.kind, "critique": attack.critique,
                  "counter_evidence": annotated if attack.kind == "evidence" else []}
        await emit({"type": "attack", "agent": "red_team", **record})
        kept.append(record)
    await emit({"type": "grounding", "agent": "red_team", "gated_in": bool(kept),
                "grounded": len(kept), "dropped": dropped})
    return {"attacks": kept}


def make_rebuttal_node(agent: str):
    async def rebuttal(state, config) -> dict:
        emit, ctx = _configurable(config)
        mine = next((t for t in state["theses"] if t["agent"] == agent), None)
        attacks = [a for a in state["attacks"] if a["target"] == agent]
        if mine is None or not mine["gated_in"] or not attacks:
            return {"rebuttals": []}  # no vote or unchallenged: no call spent
        await emit({"type": "agent_start", "agent": agent})
        attack_lines = "\n".join(f"- ({a['kind']}) {a['critique']}" for a in attacks)
        reb = await call_structured(
            Rebuttal,
            system=(f"You are the {agent} analyst, defending your thesis in a debate. "
                    "This is your one rebuttal: concede what genuinely landed, defend what did not, "
                    "and propose your revised stance (the Judge has the final word).\n" + STANCE_RUBRIC),
            user=(f"Your thesis: {_thesis_digest(mine)}\n\nAttacks on you:\n{attack_lines}\n\n"
                  f"Your data:\n{specialist_context(agent, ctx)}"),
            config=config,
        )
        await emit({"type": "rebuttal", "agent": agent,
                    "proposed_stance": reb.proposed_stance, "response": reb.response})
        return {"rebuttals": [{"agent": agent, "proposed_stance": reb.proposed_stance,
                               "response": reb.response}]}

    return rebuttal


async def judge(state, config) -> dict:
    emit, ctx = _configurable(config)
    gated = [t for t in state["theses"] if t["gated_in"]]
    if not gated:
        return {"adjudicated_stances": []}
    await emit({"type": "agent_start", "agent": "judge"})
    rebuttals = {r["agent"]: r for r in state["rebuttals"]}
    sections = []
    for t in gated:
        attacks = [a for a in state["attacks"] if a["target"] == t["agent"]]
        reb = rebuttals.get(t["agent"])
        sections.append(
            f"### {t['agent']}\nThesis: {_thesis_digest(t)}\n"
            + ("Attacks:\n" + "\n".join(f"- ({a['kind']}) {a['critique']}" for a in attacks)
               if attacks else "Attacks: none")
            + (f"\nRebuttal (proposed stance {reb['proposed_stance']:+.2f}): {reb['response']}"
               if reb else "\nRebuttal: none"))
    gated_names = sorted(t["agent"] for t in gated)
    ruling = await call_structured(
        JudgeRuling,
        system=("You are the judge — a neutral adjudicator with no directional view. For each "
                "specialist below, rule which attacks genuinely landed (an attack lands ONLY if it "
                "is grounded counter-evidence or a valid logical flaw — never unsupported doubt) and "
                "set their adjudicated_stance in [-1, +1], weighing thesis, landed attacks, and "
                "rebuttal. You do NOT compute any overall verdict — that is done arithmetically. "
                f"Return exactly one ruling per specialist: {gated_names}."),
        user="\n\n".join(sections),
        config=config,
        post_validate=lambda r: _rulings_cover(r, gated_names),
    )
    stances = []
    for r in ruling.rulings:
        if r.agent not in gated_names:
            continue
        await emit({"type": "adjudication", "agent": r.agent,
                    "adjudicated_stance": r.adjudicated_stance,
                    "attacks_landed": r.attacks_landed, "rationale": r.rationale})
        stances.append({"agent": r.agent, "adjudicated_stance": r.adjudicated_stance,
                        "attacks_landed": r.attacks_landed})
    return {"adjudicated_stances": stances}


def _rulings_cover(ruling: JudgeRuling, gated_names: list) -> None:
    ruled = {r.agent for r in ruling.rulings}
    missing = [a for a in gated_names if a not in ruled]
    if missing:
        raise ValueError(f"rulings missing for: {missing}")


async def aggregate(state, config) -> dict:
    """Pure Python. The headline number is computed, never authored (ADR 0001)."""
    emit, _ = _configurable(config)
    voting = {s["agent"]: s["adjudicated_stance"] for s in state["adjudicated_stances"]}
    await emit(compute_verdict(voting))
    return {}
