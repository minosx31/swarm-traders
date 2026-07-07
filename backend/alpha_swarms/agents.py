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
import os

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from pydantic import ValidationError

from . import llm
from .grounding import earns_vote, ground_evidence
from .models import JudgeRuling, Rebuttal, RedTeamReport, Thesis
from .safeguards import BreakerTripped
from .scoring import compute_verdict
from .slices import RunContext
from .tools import (
    MAX_TOOL_ITERS,
    debate_tools_enabled,
    make_read_tools,
    submit_attack,
    submit_rebuttal,
)

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
        try:
            result = await model.ainvoke(messages, config=config)
            parsed, error = result.get("parsed"), result.get("parsing_error")
        except BreakerTripped:
            raise  # the budget kill-switch always propagates uncaught
        except Exception as exc:  # e.g. Ollama 500 on malformed model tool-call XML
            parsed, error = None, exc
        if parsed is not None and post_validate is not None:
            try:
                post_validate(parsed)
            except ValueError as exc:
                parsed, error = None, exc
        if parsed is not None:
            return parsed
        if error is None:  # model answered in prose without calling the output tool
            feedback = (f"You did not produce structured output. You MUST call the "
                        f"{schema.__name__} tool with valid JSON arguments — no prose.")
        else:
            feedback = (f"Your previous output failed validation ({error}). "
                        "Respond again with ONLY valid JSON matching the schema.")
        messages = messages + [HumanMessage(content=feedback)]
    raise StructuredOutputError(f"{schema.__name__} failed validation after one retry: {error}")


async def call_with_tools(submit_model, read_tools, *, system, user, agent, emit, config):
    """Bounded tool-calling loop (ADR 0003/0005) for a debate node.

    The model calls read tools over the cached Snapshot, then ends its turn by
    calling submit_* whose arguments ARE the exit Pydantic model. At most
    MAX_TOOL_ITERS model calls (hard iteration cap); the submit payload validates
    against the schema with exactly one retry. tool_call / tool_result display
    events are emitted per read-tool invocation. The circuit breaker (a global
    callback) still counts every model call and propagates uncaught.
    """
    submit_name = submit_model.__name__
    model = llm.get_chat_model()
    tool_map = {t.name: t for t in read_tools}
    messages = [SystemMessage(content=llm.system_content(system)), HumanMessage(content=user)]
    error = None
    for i in range(MAX_TOOL_ITERS):  # hard stop at the iteration cap
        final = i == MAX_TOOL_ITERS - 1
        if final:  # last turn: force the exit — drop the read tools, demand submit_*
            messages.append(HumanMessage(
                content=f"Stop researching. Call {submit_name} now with your final answer."))
        bound = model.bind_tools([submit_model] if final else read_tools + [submit_model])
        ai = await bound.ainvoke(messages, config=config)
        messages.append(ai)
        calls = getattr(ai, "tool_calls", None) or []
        if not calls:  # prose instead of a tool call — nudge it to the exit tool
            messages.append(HumanMessage(
                content=f"You did not call a tool. Call {submit_name} to submit and end your turn."))
            continue
        submit_call = None
        for tc in calls:
            if tc["name"] == submit_name:
                submit_call = tc  # captured; validated after the tool results are threaded
                messages.append(ToolMessage(content="received", tool_call_id=tc["id"]))
                continue
            impl = tool_map.get(tc["name"])
            if impl is None:
                messages.append(ToolMessage(content=f"unknown tool {tc['name']}", tool_call_id=tc["id"]))
                continue
            await emit({"type": "tool_call", "agent": agent, "tool": tc["name"], "args": tc["args"]})
            data = impl.invoke(tc["args"])  # reads only the cached, as-of-filtered Snapshot
            await emit({"type": "tool_result", "agent": agent, "tool": tc["name"], "data": data})
            messages.append(ToolMessage(content=json.dumps(data, default=str), tool_call_id=tc["id"]))
        if submit_call is not None:
            try:
                return submit_model.model_validate(submit_call["args"])
            except ValidationError as exc:  # one validation-retry, same bar as call_structured
                error = exc
                messages.append(HumanMessage(
                    content=f"Your {submit_name} arguments failed validation ({exc}). "
                            f"Call {submit_name} again with corrected arguments."))
    raise StructuredOutputError(
        f"{submit_name} not submitted within {MAX_TOOL_ITERS} tool iterations: {error}")


def _configurable(config):
    c = config["configurable"]
    return c["emit"], c["run_context"]


def resilient_enabled() -> bool:
    """Opt-in (RESILIENT=1): a debate node whose LLM production fails degrades to
    an abstention (contributes nothing) so the run still reaches a verdict, rather
    than aborting with a terminal error. Off by default — the honest fail-loud
    contract (#4). Set it when recording local demo runs to maximize completed
    takes on the flaky local models."""
    return os.environ.get("RESILIENT", "").strip().lower() in ("1", "true", "yes", "on")


async def _produce(coro):
    """Await a debate node's LLM production. In RESILIENT mode a model-output
    failure returns None (the node abstains); the budget breaker always
    propagates. Off by default: failures propagate to a terminal error event,
    unchanged from #4-#6."""
    if not resilient_enabled():
        return await coro
    try:
        return await coro
    except BreakerTripped:
        raise  # budget kill-switch is never swallowed
    except Exception as exc:  # noqa: BLE001 — deliberately broad: any node can abstain
        print(f"[resilient] node abstained: {type(exc).__name__}: {exc}", flush=True)
        return None


# --- prompt fragments ---------------------------------------------------------

STANCE_RUBRIC = (
    "Stance is one signed number in [-1, +1]: sign is direction (negative=bear, "
    "positive=bull), magnitude is conviction. Calibrate magnitude to the weight of "
    "evidence, not to how strongly you feel:\n"
    "  |0.75-1.0| — multiple independent signals agree and you found no material contrary data.\n"
    "  |0.40-0.70| — the evidence leans clearly one way, but at least one signal cuts against it.\n"
    "  |0.15-0.35| — mixed or thin evidence; a weak tilt only.\n"
    "  <0.15 — genuinely balanced or insufficient data; do not manufacture conviction.\n"
    "Cite ONLY the data provided below — every claim needs an exact citation. "
    "Fabricated or mis-copied citations are dropped by a deterministic validator "
    "and cost you your vote."
)

SPECIALIST_BRIEFS = {
    "fundamentals": ("You are the fundamentals analyst. Judge the business across four axes: "
                     "(1) valuation — is the price justified by earnings/revenue and their trajectory; "
                     "(2) profitability & margins — the direction and quality of earnings; "
                     "(3) balance-sheet health — leverage, liquidity, solvency risk; "
                     "(4) growth — is the top and bottom line expanding or contracting. "
                     "Reason across all four, name the tension explicitly when they disagree "
                     "(e.g. cheap but deteriorating, growing but unprofitable), and let that balance — "
                     "not any single metric — set your stance. "
                     "Use numeric evidence: cite an exact citation_key and its value for every claim."),
    "sentiment": ("You are the sentiment analyst. Judge the narrative across four axes: "
                  "(1) catalyst vs. noise — is an item materially price-moving or routine coverage; "
                  "(2) tone & direction — is the balance of coverage constructive or damaging; "
                  "(3) momentum — is the narrative building or fading across the window; "
                  "(4) breadth & credibility — one outlet's take or corroborated across sources. "
                  "Reason across all four, name the tension explicitly when they disagree "
                  "(e.g. loud but one-sourced, positive but stale), and let that balance — not any "
                  "single headline — set your stance. "
                  "Use textual evidence: cite an exact source_id and quote a short verbatim span for every claim. "
                  "If no news is provided, say so in your summary and take a stance near 0 "
                  "with an empty evidence list — do NOT invent sources."),
    "technicals": ("You are the technicals analyst. Judge price action across four axes: "
                   "(1) trend — price relative to its moving averages and the structure of higher/lower highs; "
                   "(2) momentum — the rate and direction of returns across the available horizons; "
                   "(3) volume — does participation confirm the move or diverge from it; "
                   "(4) position — distance from 52-week extremes and any stretched/overextended reading. "
                   "Reason across all four, name the tension explicitly when they disagree "
                   "(e.g. downtrend but oversold, up but on thinning volume), and let that balance — "
                   "not any single indicator — set your stance. "
                   "Use numeric evidence: cite an exact citation_key and its value for every claim."),
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
        thesis = await _produce(call_structured(
            Thesis,
            system=f"{SPECIALIST_BRIEFS[agent]}\n{STANCE_RUBRIC}",
            user=specialist_context(agent, ctx),
            config=config,
        ))
        if thesis is None:  # resilient abstention: this lens takes no vote
            await emit({"type": "grounding", "agent": agent, "gated_in": False,
                        "grounded": 0, "dropped": 0})
            return {"theses": []}
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
    system = ("You are the red-team. Attack each thesis below with its strongest counter-case. "
              "kind='evidence' attacks MUST cite the provided data (same exact-citation rule); "
              "kind='logical' attacks expose an internal flaw (contradiction, over-extrapolation, "
              "ignoring a provided datum) and need no new evidence. Unsupported doubt does not count.\n"
              + STANCE_RUBRIC)
    if debate_tools_enabled():
        report = await _produce(call_with_tools(
            submit_attack, make_read_tools(ctx),
            system=(system + "\nUse the read tools to pull the cached data you need to build "
                    "evidence attacks, then call submit_attack to end your turn."),
            user=f"Theses under attack:\n{digests}",
            agent="red_team", emit=emit, config=config))
    else:
        report = await _produce(call_structured(
            RedTeamReport, system=system,
            user=(f"Theses under attack:\n{digests}\n\n"
                  f"Data (citation_key = value):\n{_numeric_block(ctx.numeric_keys)}\n\n"
                  f"Cached news:\n{_news_block(ctx)}"),
            config=config))
    if report is None:  # resilient abstention: no attacks this round, debate continues
        await emit({"type": "grounding", "agent": "red_team", "gated_in": False,
                    "grounded": 0, "dropped": 0})
        return {"attacks": []}
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
        system = (f"You are the {agent} analyst, defending your thesis in a debate. "
                  "This is your one rebuttal: concede what genuinely landed, defend what did not, "
                  "and propose your revised stance (the Judge has the final word).\n" + STANCE_RUBRIC)
        if debate_tools_enabled():
            reb = await _produce(call_with_tools(
                submit_rebuttal, make_read_tools(ctx),
                system=(system + "\nUse the read tools to pull cached data that defends your "
                        "thesis, then call submit_rebuttal to end your turn."),
                user=f"Your thesis: {_thesis_digest(mine)}\n\nAttacks on you:\n{attack_lines}",
                agent=agent, emit=emit, config=config))
        else:
            reb = await _produce(call_structured(
                Rebuttal, system=system,
                user=(f"Your thesis: {_thesis_digest(mine)}\n\nAttacks on you:\n{attack_lines}\n\n"
                      f"Your data:\n{specialist_context(agent, ctx)}"),
                config=config))
        if reb is None:  # resilient abstention: no rebuttal, judge weighs thesis + attacks
            return {"rebuttals": []}
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
    ruling = await _produce(call_structured(
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
    ))
    if ruling is None:  # resilient abstention: no adjudication → aggregate returns No Call
        return {"adjudicated_stances": []}
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
