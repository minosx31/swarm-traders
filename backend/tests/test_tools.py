"""Issue #8 acceptance: debate-phase tool-calling over the cached Snapshot."""

from datetime import date

import pytest

from alpha_swarms import llm
from alpha_swarms.agents import StructuredOutputError, call_with_tools
from alpha_swarms.safeguards import RunSafeguards
from alpha_swarms.slices import RunContext
from alpha_swarms.snapshot import (
    NewsItem,
    PriceBar,
    ReportedFundamentals,
    Snapshot,
    load_snapshot,
)
from alpha_swarms.tools import (
    debate_tools_enabled,
    financials_at,
    make_read_tools,
    news_at,
    prices_at,
    submit_attack,
)
from tests import fakes
from tests.conftest import WHITELISTED

TICKER, AS_OF = WHITELISTED["ticker"], WHITELISTED["as_of"]


@pytest.fixture
def scripted(monkeypatch):
    def install(script: dict) -> fakes.ScriptedChatModel:
        model = fakes.ScriptedChatModel(script=script)
        monkeypatch.setattr(llm, "get_chat_model", lambda: model)
        return model

    return install


@pytest.fixture
def tools_on(monkeypatch):
    monkeypatch.setenv("DEBATE_TOOLS", "1")


# --- leakage impossible by construction (property, not prompt) ------------------


def _leaky_snapshot() -> Snapshot:
    """A snapshot deliberately carrying data AFTER 2026-06-30 (could never be
    saved — validate_snapshot rejects it — so we build it in memory) to prove the
    tool's as_of filter, not the ingestion filter, is what excludes the future."""
    return Snapshot(
        ticker="TST", as_of=date(2026, 6, 30),
        prices=[
            PriceBar(date=date(2026, 6, 29), open=100, high=101, low=99, close=100.0,
                     volume=1000, available_at=date(2026, 6, 29)),
            PriceBar(date=date(2026, 7, 15), open=200, high=201, low=199, close=200.0,
                     volume=2000, available_at=date(2026, 7, 15)),
        ],
        fundamentals=ReportedFundamentals(
            period_end=date(2026, 6, 30), available_at=date(2026, 8, 14),
            income_stmt={"Total Revenue": 5.0}, balance_sheet={}),
        news=[
            NewsItem(source_id="past", title="t", summary="s",
                     published_at=date(2026, 6, 28), available_at=date(2026, 6, 28)),
            NewsItem(source_id="future", title="t", summary="s",
                     published_at=date(2026, 7, 10), available_at=date(2026, 7, 10)),
        ],
    )


def test_readers_never_return_a_datum_dated_after_as_of():
    snap = _leaky_snapshot()
    as_of = snap.as_of  # 2026-06-30

    # news: only the item available by as_of
    assert [n["source_id"] for n in news_at(snap, as_of)] == ["past"]
    # fundamentals: filed 2026-08-14 > as_of, so nothing is returned
    assert financials_at(snap, as_of) == {}
    # prices: derived from the 06-29 bar only, never the 07-15 bar
    assert prices_at(snap, as_of)["technicals.close_latest"] == 100.0


def test_readers_admit_data_once_as_of_reaches_it():
    snap = _leaky_snapshot()
    later = date(2026, 8, 31)  # now everything is in the past

    assert {n["source_id"] for n in news_at(snap, later)} == {"past", "future"}
    assert financials_at(snap, later) == {"income_stmt.Total Revenue": 5.0}
    assert prices_at(snap, later)["technicals.close_latest"] == 200.0


def test_bound_read_tool_cannot_be_asked_for_a_later_date():
    # as_of is closed over, not a model-supplied argument: the model has no lever
    # to request a later date. get_news takes no date parameter at all.
    ctx = RunContext(_leaky_snapshot())
    get_news = next(t for t in make_read_tools(ctx) if t.name == "get_news")
    assert get_news.args == {}
    assert [n["source_id"] for n in get_news.invoke({})] == ["past"]


# --- the tool loop end-to-end ---------------------------------------------------


async def run_events(safeguards=None):
    from alpha_swarms.runner import stream_run

    return [e async for e in stream_run(TICKER, AS_OF, delay=0,
                                        safeguards=safeguards or RunSafeguards())]


async def test_tool_mode_streams_tool_events_between_attack_and_rebuttal(scripted, tools_on):
    scripted(fakes.full_tool_debate_script())
    safeguards = RunSafeguards()
    events = await run_events(safeguards)
    types = [e["type"] for e in events]

    assert "error" not in types
    assert types[-1] == "verdict"
    assert "tool_call" in types and "tool_result" in types

    # each tool_call is immediately followed by its tool_result, timed (#13)
    for i, e in enumerate(events):
        if e["type"] == "tool_call":
            assert events[i + 1]["type"] == "tool_result"
            assert events[i + 1]["tool"] == e["tool"]
            assert isinstance(events[i + 1]["duration_s"], (int, float))

    # a rebuttal's tool activity lands AFTER the attack on it and BEFORE its rebuttal
    idx = {("tool_call", "fundamentals"): None, ("attack", "fundamentals"): None,
           ("rebuttal", "fundamentals"): None}
    for i, e in enumerate(events):
        if e["type"] == "attack" and e["target"] == "fundamentals":
            idx[("attack", "fundamentals")] = i
        if e["type"] == "tool_call" and e["agent"] == "fundamentals":
            idx[("tool_call", "fundamentals")] = i
        if e["type"] == "rebuttal" and e["agent"] == "fundamentals":
            idx[("rebuttal", "fundamentals")] = i
    assert (idx[("attack", "fundamentals")]
            < idx[("tool_call", "fundamentals")]
            < idx[("rebuttal", "fundamentals")])

    # red-team also uses tools (before it emits its attacks)
    assert any(e["type"] == "tool_call" and e["agent"] == "red_team" for e in events)


async def test_full_tool_run_stays_under_the_breaker(scripted, tools_on):
    scripted(fakes.full_tool_debate_script())
    safeguards = RunSafeguards()
    await run_events(safeguards)
    # 6 specialist (fetch+submit ×3) + 2 red-team + 6 rebuttal + 1 judge = 15, under 20
    assert safeguards.calls == 15
    assert safeguards.calls < safeguards.max_calls


# --- specialists are tool-using agents too (the DEBATE_TOOLS extension) ----------


def test_submit_thesis_exit_tool_is_a_thesis():
    from alpha_swarms.models import Thesis
    from alpha_swarms.tools import submit_thesis

    # the exit tool's arg schema IS the Thesis model, so a submitted payload is a Thesis
    assert issubclass(submit_thesis, Thesis)
    t = submit_thesis.model_validate({
        "stance": 0.5, "summary": "s",
        "evidence": [{"kind": "numeric", "claim": "c",
                      "citation_key": "income_stmt.Total Revenue", "cited_value": 1.0}]})
    assert t.stance == 0.5 and t.evidence[0].citation_key == "income_stmt.Total Revenue"


def test_specialist_gets_only_its_own_lane_tool():
    from alpha_swarms.tools import make_specialist_tools

    # lane isolation: a specialist can fetch (and therefore cite) only its own lane
    ctx = RunContext(load_snapshot(TICKER, AS_OF))
    assert [t.name for t in make_specialist_tools("fundamentals", ctx)] == ["get_financials"]
    assert [t.name for t in make_specialist_tools("technicals", ctx)] == ["get_price_history"]
    assert [t.name for t in make_specialist_tools("sentiment", ctx)] == ["get_news"]


async def test_tool_mode_specialist_researches_then_grounds(scripted, tools_on):
    scripted(fakes.full_tool_debate_script())
    events = await run_events()
    fund = [e for e in events if e.get("agent") == "fundamentals"]
    kinds = [e["type"] for e in fund]

    # the specialist fetches its lane tool BEFORE producing the thesis it feeds
    assert kinds.index("tool_call") < kinds.index("thesis")
    assert next(e["tool"] for e in fund if e["type"] == "tool_call") == "get_financials"
    # fundamentals only ever touches its own lane tool (never sentiment's / technicals')
    assert all(e["tool"] == "get_financials" for e in fund if e["type"] == "tool_call")
    # and the tool-fetched thesis still clears the deterministic grounding gate
    assert next(e for e in fund if e["type"] == "grounding")["gated_in"] is True


# --- the submit_* exit + one validation-retry -----------------------------------


async def _call_red_team_with_tools(model_script):
    """Drive call_with_tools directly for the red-team, returning (result, handler)."""
    ctx = RunContext(load_snapshot(TICKER, AS_OF))
    handler = RunSafeguards()
    events = []

    async def emit(e):
        events.append(e)

    result = await call_with_tools(
        submit_attack, make_read_tools(ctx),
        system="You are the red-team.", user="attack",
        agent="red_team", emit=emit,
        config={"callbacks": [handler]})
    return result, handler


async def test_submit_validates_with_exactly_one_retry(scripted):
    bad = fakes.tool_call_turn(("submit_attack", {"attacks": [
        {"target": "macro", "kind": "logical", "critique": "x"}]}))  # 'macro' not a valid target
    good = fakes.tool_call_turn(("submit_attack", {"attacks": fakes.ATTACKS_ALL}))
    scripted({"red-team": [bad, good]})
    result, handler = await _call_red_team_with_tools(None)
    assert isinstance(result, submit_attack)
    assert {a.target for a in result.attacks} == {"fundamentals", "sentiment", "technicals"}
    assert handler.calls == 2  # invalid submit + one retry


async def test_loop_hard_stops_at_the_iteration_cap(scripted):
    from alpha_swarms.tools import MAX_TOOL_ITERS

    fetch = fakes.tool_call_turn(("get_financials", {}))
    scripted({"red-team": [fetch] * (MAX_TOOL_ITERS + 2)})  # never submits
    with pytest.raises(StructuredOutputError):
        await _call_red_team_with_tools(None)


# --- the flag reproduces the #6 baseline ----------------------------------------


# --- RESILIENT mode: a failing node abstains, the run still reaches a verdict ----


async def test_resilient_red_team_failure_degrades_to_no_attacks_not_error(scripted, monkeypatch):
    monkeypatch.setenv("RESILIENT", "1")
    script = fakes.full_debate_script()
    script["red-team"] = [fakes.MALFORMED, fakes.MALFORMED]  # both attempts fail
    # judge only sees the (unattacked) gated theses
    script["You are the judge"] = [fakes.judge_ruling(
        {"fundamentals": 0.4, "sentiment": 0.1, "technicals": -0.3})]
    scripted(script)
    events = await run_events()
    types = [e["type"] for e in events]

    assert "error" not in types  # the run survives the red-team failure
    assert types[-1] == "verdict"
    assert not any(e["type"] == "attack" for e in events)  # no attacks landed this round
    rt_gate = next(e for e in events if e["type"] == "grounding" and e["agent"] == "red_team")
    assert rt_gate["gated_in"] is False


async def test_resilient_off_by_default_still_fails_loud(scripted, monkeypatch):
    monkeypatch.delenv("RESILIENT", raising=False)
    script = fakes.full_debate_script()
    script["red-team"] = [fakes.MALFORMED, fakes.MALFORMED]
    scripted(script)
    events = await run_events()
    assert events[-1]["type"] == "error"  # unchanged fail-loud contract


async def test_flag_off_reproduces_baseline_with_no_tool_events(scripted, monkeypatch):
    monkeypatch.delenv("DEBATE_TOOLS", raising=False)
    assert debate_tools_enabled() is False
    scripted(fakes.full_debate_script())
    safeguards = RunSafeguards()
    events = await run_events(safeguards)
    types = [e["type"] for e in events]
    assert "tool_call" not in types and "tool_result" not in types
    assert types[-1] == "verdict"
    assert safeguards.calls == 8  # the unchanged pre-sliced budget
