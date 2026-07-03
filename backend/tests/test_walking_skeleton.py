"""Issue #1 acceptance: mock swarm streams the full SSE contract end-to-end."""

import pytest
from langgraph.graph import END, START, StateGraph

from alpha_swarms.app import app
from alpha_swarms.graph import SPECIALISTS, Blackboard, build_graph
from alpha_swarms.runner import stream_run
from tests.conftest import collect_sse_events

CONTRACT_ORDER = ["agent_start", "thesis", "attack", "tool_call", "tool_result",
                  "rebuttal", "adjudication", "verdict"]


async def test_stream_yields_full_contract_in_order():
    status, events = await collect_sse_events(app, {"ticker": "NVDA", "as_of": "2026-06-30"})
    assert status == 200
    types = [e["type"] for e in events]

    # All seven contract event types appear (tool_call/tool_result share a row)
    for t in CONTRACT_ORDER:
        assert t in types, f"missing event type {t}"
    assert "error" not in types

    # Contract order: first occurrence of each type follows ARCHITECTURE §3
    first = {t: types.index(t) for t in CONTRACT_ORDER}
    assert first["agent_start"] < first["thesis"] < first["attack"]
    assert first["attack"] < first["tool_call"] < first["tool_result"] < first["rebuttal"]
    assert first["rebuttal"] < first["adjudication"] < first["verdict"]

    # All theses precede the first attack; verdict is terminal and closes cleanly
    assert types.count("thesis") == 3
    assert max(i for i, t in enumerate(types) if t == "thesis") < first["attack"]
    assert types[-1] == "verdict"

    verdict = events[-1]
    assert verdict["voting_lenses"] == 3
    assert "conviction" in verdict and "dissent" in verdict


def test_graph_topology_is_fixed_linear_with_fanout():
    compiled = build_graph()
    edges = {(e.source, e.target) for e in compiled.get_graph().edges}

    for agent in SPECIALISTS:
        assert ("__start__", agent) in edges
        assert (agent, "red_team") in edges
        assert ("red_team", f"rebuttal_{agent}") in edges
        assert (f"rebuttal_{agent}", "judge") in edges
    assert ("judge", "aggregate") in edges
    assert ("aggregate", "__end__") in edges

    # No convergence loop: every edge moves strictly forward through the phases
    rank = {"__start__": 0, **{a: 1 for a in SPECIALISTS}, "red_team": 2,
            **{f"rebuttal_{a}": 3 for a in SPECIALISTS}, "judge": 4, "aggregate": 5, "__end__": 6}
    for src, dst in edges:
        assert rank[src] < rank[dst], f"backward edge {src} -> {dst}"


async def test_mid_graph_raise_surfaces_as_terminal_error_event():
    async def exploding(state, config):
        raise RuntimeError("boom mid-graph")

    g = StateGraph(Blackboard)
    g.add_node("exploding", exploding)
    g.add_edge(START, "exploding")
    g.add_edge("exploding", END)

    events = [e async for e in stream_run("NVDA", "2026-06-30", graph=g.compile(), delay=0)]
    assert events, "expected a terminal error event, not a dead socket"
    assert events[-1]["type"] == "error"
    assert "boom mid-graph" in events[-1]["message"]


async def test_zero_llm_calls_in_skeleton():
    # No LLM client is even constructed: the langchain provider modules stay unimported.
    import sys

    [e async for e in stream_run("NVDA", "2026-06-30", delay=0)]
    for mod in ("langchain_ollama", "langchain_anthropic", "langchain_groq"):
        assert mod not in sys.modules
