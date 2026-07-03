"""Issues #4-#6 acceptance: the real debate pipeline end-to-end (scripted LLM)."""

import json

import pytest

from alpha_swarms import llm
from alpha_swarms.agents import StructuredOutputError, call_structured
from alpha_swarms.graph import build_graph
from alpha_swarms.models import Thesis
from alpha_swarms.runner import stream_run
from alpha_swarms.safeguards import RunSafeguards
from alpha_swarms.slices import RunContext
from alpha_swarms.snapshot import load_snapshot
from tests import fakes
from tests.conftest import WHITELISTED, collect_sse_events

TICKER, AS_OF = WHITELISTED["ticker"], WHITELISTED["as_of"]


@pytest.fixture
def scripted(monkeypatch):
    """Install a scripted chat model; returns a setter for per-test scripts."""

    def install(script: dict[str, list[str]]) -> fakes.ScriptedChatModel:
        model = fakes.ScriptedChatModel(script=script)
        monkeypatch.setattr(llm, "get_chat_model", lambda: model)
        return model

    return install


async def run_events(safeguards=None):
    return [e async for e in stream_run(TICKER, AS_OF, delay=0,
                                        safeguards=safeguards or RunSafeguards())]


# --- full pipeline (#6) ---------------------------------------------------------


async def test_full_debate_streams_contract_in_order_with_8_calls(scripted):
    scripted(fakes.full_debate_script())
    safeguards = RunSafeguards()
    events = await run_events(safeguards)
    types = [e["type"] for e in events]

    assert "error" not in types
    for t in ("agent_start", "thesis", "grounding", "attack", "rebuttal", "adjudication", "verdict"):
        assert t in types, f"missing {t}"

    first = {t: types.index(t) for t in set(types)}
    assert first["agent_start"] < first["thesis"] < first["attack"]
    assert first["attack"] < first["rebuttal"] < first["adjudication"] < first["verdict"]
    assert types.count("thesis") == 3
    assert max(i for i, t in enumerate(types) if t == "thesis") < first["attack"]
    assert types[-1] == "verdict"

    # ~8 LLM calls: 3 theses + 1 red-team + 3 rebuttals + 1 judge (breaker confirms)
    assert safeguards.calls == 8

    # per-specialist stance trail is visible: initial -> proposed -> adjudicated
    thesis = next(e for e in events if e["type"] == "thesis" and e["agent"] == "fundamentals")
    reb = next(e for e in events if e["type"] == "rebuttal" and e["agent"] == "fundamentals")
    adj = next(e for e in events if e["type"] == "adjudication" and e["agent"] == "fundamentals")
    assert (thesis["stance"], reb["proposed_stance"], adj["adjudicated_stance"]) == (0.7, 0.55, 0.4)

    verdict = events[-1]
    assert verdict["voting_lenses"] == 3 and "conviction" in verdict and "dissent" in verdict


async def test_thesis_events_cite_real_snapshot_keys(scripted):
    scripted(fakes.full_debate_script())
    events = await run_events()
    ctx = RunContext(load_snapshot(TICKER, AS_OF))
    for e in (e for e in events if e["type"] == "thesis"):
        for item in e["evidence"]:
            assert item["grounded"]
            if item["kind"] == "numeric":
                assert item["citation_key"] in ctx.numeric_keys


async def test_full_run_over_sse_endpoint(scripted):
    from alpha_swarms.app import app

    scripted(fakes.full_debate_script())
    status, events = await collect_sse_events(app, WHITELISTED)
    assert status == 200
    assert events[-1]["type"] == "verdict"


# --- grounding gate in the pipeline (#5) ---------------------------------------


async def test_ungrounded_specialist_is_excluded_and_stream_shows_it(scripted):
    script = fakes.full_debate_script(sentiment_thesis=fakes.THESIS_SENTIMENT_FABRICATED)
    # red-team still attacks all three; the attack on gated-out sentiment must be dropped
    script["You are the judge"] = [fakes.judge_ruling({"fundamentals": 0.4, "technicals": -0.3})]
    scripted(script)
    events = await run_events()

    gate = next(e for e in events if e["type"] == "grounding" and e["agent"] == "sentiment")
    assert gate["gated_in"] is False and gate["grounded"] == 0
    assert not any(e["type"] == "attack" and e["target"] == "sentiment" for e in events)
    assert not any(e["type"] == "rebuttal" and e["agent"] == "sentiment" for e in events)
    assert not any(e["type"] == "adjudication" and e["agent"] == "sentiment" for e in events)
    assert events[-1]["voting_lenses"] == 2


async def test_quorum_failure_yields_no_call(scripted):
    fabricated = fakes.make_thesis(citation_key="made.up", stance=0.9)
    script = fakes.full_debate_script(sentiment_thesis=fakes.THESIS_SENTIMENT_FABRICATED)
    script["technicals analyst"] = [fabricated]
    script["red-team"] = [json.dumps({"attacks": [
        {"target": "fundamentals", "kind": "logical",
         "critique": "One quarter is not a trend", "counter_evidence": []}]})]
    script["You are the judge"] = [fakes.judge_ruling({"fundamentals": 0.4})]
    scripted(script)
    events = await run_events()

    verdict = events[-1]
    assert verdict["type"] == "verdict" and verdict["direction"] == "no_call"
    assert verdict["voting_lenses"] == 1 and "quorum" in verdict["reason"]


async def test_ungrounded_red_team_evidence_attack_is_dropped(scripted):
    script = fakes.full_debate_script()
    script["red-team"] = [json.dumps({"attacks": [
        {"target": "fundamentals", "kind": "evidence", "critique": "Margins imploding",
         "counter_evidence": [{"kind": "numeric", "claim": "x",
                               "citation_key": "made.up.key", "cited_value": 1.0}]},
        {"target": "technicals", "kind": "logical",
         "critique": "Single bar is not a trend", "counter_evidence": []}]})]
    script["You are the judge"] = [fakes.judge_ruling(
        {"fundamentals": 0.6, "sentiment": 0.1, "technicals": -0.3})]
    scripted(script)
    events = await run_events()

    attacks = [e for e in events if e["type"] == "attack"]
    assert len(attacks) == 1 and attacks[0]["target"] == "technicals"
    rt_gate = next(e for e in events if e["type"] == "grounding" and e["agent"] == "red_team")
    assert rt_gate["dropped"] == 1


async def test_blackboard_carries_summaries_not_raw_reasoning(scripted):
    scripted(fakes.full_debate_script())
    events, state = [], None
    ctx = RunContext(load_snapshot(TICKER, AS_OF))

    async def emit(e):
        events.append(e)

    state = await build_graph().ainvoke(
        {"ticker": TICKER, "as_of": AS_OF, "theses": [], "attacks": [],
         "rebuttals": [], "adjudicated_stances": []},
        config={"configurable": {"emit": emit, "run_context": ctx}})
    for thesis in state["theses"]:
        assert set(thesis) == {"agent", "stance", "summary", "grounded_evidence", "gated_in"}


def test_graph_topology_is_fixed_linear_with_fanout():
    compiled = build_graph()
    edges = {(e.source, e.target) for e in compiled.get_graph().edges}
    for agent in ("fundamentals", "sentiment", "technicals"):
        assert ("__start__", agent) in edges
        assert (agent, "red_team") in edges
        assert ("red_team", f"rebuttal_{agent}") in edges
        assert (f"rebuttal_{agent}", "judge") in edges
    assert ("judge", "aggregate") in edges and ("aggregate", "__end__") in edges
    rank = {"__start__": 0, "fundamentals": 1, "sentiment": 1, "technicals": 1, "red_team": 2,
            "rebuttal_fundamentals": 3, "rebuttal_sentiment": 3, "rebuttal_technicals": 3,
            "judge": 4, "aggregate": 5, "__end__": 6}
    for src, dst in edges:
        assert rank[src] < rank[dst], f"backward edge {src} -> {dst}"  # no convergence loop


# --- structured output retry (#4) -----------------------------------------------


def _ctx_config(model):
    return {"configurable": {"emit": None, "run_context": None}}


async def test_one_validation_retry_then_success(scripted):
    model = scripted({"analyst": [fakes.MALFORMED, fakes.make_thesis()]})
    handler = RunSafeguards()
    thesis = await call_structured(Thesis, system="analyst", user="go",
                                   config={"callbacks": [handler]})
    assert isinstance(thesis, Thesis)
    assert handler.calls == 2  # initial + exactly one retry


async def test_exhausted_retry_fails_gracefully_not_crash(scripted):
    scripted({"analyst": [fakes.MALFORMED, fakes.MALFORMED, fakes.make_thesis()]})
    handler = RunSafeguards()
    with pytest.raises(StructuredOutputError):
        await call_structured(Thesis, system="analyst", user="go",
                              config={"callbacks": [handler]})
    assert handler.calls == 2  # never a third attempt


async def test_malformed_output_surfaces_as_terminal_error_event(scripted):
    script = fakes.full_debate_script()
    script["fundamentals analyst"] = [fakes.MALFORMED, fakes.MALFORMED]
    scripted(script)
    events = await run_events()
    assert events[-1]["type"] == "error"
    assert events[-1]["error"] == "StructuredOutputError"
