"""The fixed two-turn debate graph (ARCHITECTURE §2) — mock nodes only (issue #1).

Topology is the fixed linear sequence with parallel fan-out/fan-in, no
convergence loop:

    START ─┬─ fundamentals ─┐
           ├─ sentiment     ├─ red_team ─┬─ rebuttal(f) ─┐
           └─ technicals   ─┘            ├─ rebuttal(s)  ├─ judge ─ aggregate ─ END
                                         └─ rebuttal(t) ─┘

Every LLM-shaped node is a mock emitting hardcoded display events; the
aggregate node is pure Python (ADR 0001: the headline number is computed,
never authored). Zero LLM calls.

Nodes reach the per-run EventEmitter through config["configurable"]["emit"] —
display events and LangGraph state updates are independent channels (ADR 0004).
"""

import operator
from statistics import mean
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

SPECIALISTS = ("fundamentals", "sentiment", "technicals")


class Blackboard(TypedDict):
    """Shared state. Lists merge via operator.add so parallel fan-out is safe."""

    ticker: str
    as_of: str
    theses: Annotated[list[dict], operator.add]
    attacks: Annotated[list[dict], operator.add]
    rebuttals: Annotated[list[dict], operator.add]
    adjudicated_stances: Annotated[list[dict], operator.add]


# --- hardcoded mock content -------------------------------------------------

MOCK_THESES = {
    "fundamentals": {
        "stance": 0.7,
        "evidence": [
            {"claim": "Revenue grew 18% YoY", "citation_key": "income.revenue_yoy", "cited_value": 0.18},
            {"claim": "Gross margin expanded to 46%", "citation_key": "income.gross_margin", "cited_value": 0.46},
        ],
    },
    "sentiment": {
        "stance": 0.3,
        "evidence": [
            {"claim": "Analysts raised targets after the print", "source_id": "news-001",
             "quoted_span": "raised its price target"},
        ],
    },
    "technicals": {
        "stance": -0.4,
        "evidence": [
            {"claim": "Price broke below the 50-day moving average", "citation_key": "prices.sma50_break",
             "cited_value": True},
        ],
    },
}

MOCK_ATTACKS = {
    "fundamentals": {
        "kind": "evidence",
        "critique": "Margins are compressing sequentially despite the YoY gain",
        "counter_evidence": [
            {"claim": "Gross margin fell 120bps QoQ", "citation_key": "income.gross_margin_qoq",
             "cited_value": -0.012},
        ],
    },
    "sentiment": {
        "kind": "logical",
        "critique": "Single upgrade over-extrapolated to broad analyst sentiment",
        "counter_evidence": [],
    },
    "technicals": {
        "kind": "evidence",
        "critique": "Volume on the breakdown was below average — weak signal",
        "counter_evidence": [
            {"claim": "Breakdown-day volume was 0.7x the 30-day average", "citation_key": "prices.volume_ratio",
             "cited_value": 0.7},
        ],
    },
}

MOCK_REBUTTALS = {
    "fundamentals": {"proposed_stance": 0.55},
    "sentiment": {"proposed_stance": 0.2},
    "technicals": {"proposed_stance": -0.35},
}

MOCK_ADJUDICATIONS = {
    "fundamentals": {"adjudicated_stance": 0.4, "attacks_landed": ["margin compression QoQ"]},
    "sentiment": {"adjudicated_stance": 0.1, "attacks_landed": ["over-extrapolated sentiment"]},
    "technicals": {"adjudicated_stance": -0.3, "attacks_landed": []},
}


# --- nodes ------------------------------------------------------------------


def _emit_from(config):
    return config["configurable"]["emit"]


def make_specialist_node(agent: str):
    async def specialist(state: Blackboard, config) -> dict:
        emit = _emit_from(config)
        await emit({"type": "agent_start", "agent": agent})
        thesis = MOCK_THESES[agent]
        await emit({"type": "thesis", "agent": agent, **thesis})
        return {"theses": [{"agent": agent, **thesis}]}

    return specialist


async def red_team(state: Blackboard, config) -> dict:
    emit = _emit_from(config)
    await emit({"type": "agent_start", "agent": "red_team"})
    attacks = []
    for thesis in state["theses"]:
        target = thesis["agent"]
        attack = {"target": target, **MOCK_ATTACKS[target]}
        await emit({"type": "attack", "agent": "red_team", **attack})
        attacks.append(attack)
    return {"attacks": attacks}


def make_rebuttal_node(agent: str):
    async def rebuttal(state: Blackboard, config) -> dict:
        emit = _emit_from(config)
        await emit({"type": "agent_start", "agent": agent})
        if agent == "fundamentals":
            # Mock the debate-phase tool round-trip (real version is issue #8)
            # so the skeleton exercises all seven contract event types.
            args = {"ticker": state["ticker"], "as_of": state["as_of"]}
            await emit({"type": "tool_call", "agent": agent, "tool": "get_financials", "args": args})
            await emit({"type": "tool_result", "agent": agent, "tool": "get_financials",
                        "data": {"income.gross_margin_qoq": -0.012}})
        reb = MOCK_REBUTTALS[agent]
        await emit({"type": "rebuttal", "agent": agent, **reb})
        return {"rebuttals": [{"agent": agent, **reb}]}

    return rebuttal


async def judge(state: Blackboard, config) -> dict:
    emit = _emit_from(config)
    await emit({"type": "agent_start", "agent": "judge"})
    stances = []
    for agent in SPECIALISTS:
        adjudication = {"agent": agent, **MOCK_ADJUDICATIONS[agent]}
        await emit({"type": "adjudication", **adjudication})
        stances.append(adjudication)
    return {"adjudicated_stances": stances}


async def aggregate(state: Blackboard, config) -> dict:
    """Pure Python — computes the Verdict from adjudicated stances (ADR 0001)."""
    emit = _emit_from(config)
    voting = state["adjudicated_stances"]
    if len(voting) < 2:
        await emit({"type": "verdict", "direction": "no_call",
                    "reason": f"quorum not met (<2 grounded lenses, N={len(voting)})"})
        return {}
    stances = [s["adjudicated_stance"] for s in voting]
    agg = mean(stances)
    if agg > 0.25:
        direction = "bull"
    elif agg < -0.25:
        direction = "bear"
    else:
        direction = "neutral"
    spread = max(stances) - min(stances)
    dissent = "low" if spread < 0.5 else "med" if spread < 1.0 else "high"
    await emit({"type": "verdict", "aggregate_stance": round(agg, 3), "direction": direction,
                "conviction": round(abs(agg), 3), "high_conviction": abs(agg) > 0.75,
                "dissent": dissent, "voting_lenses": len(voting)})
    return {}


def build_graph():
    g = StateGraph(Blackboard)
    for agent in SPECIALISTS:
        g.add_node(agent, make_specialist_node(agent))
        g.add_edge(START, agent)
        g.add_edge(agent, "red_team")
    g.add_node("red_team", red_team)
    for agent in SPECIALISTS:
        node = f"rebuttal_{agent}"
        g.add_node(node, make_rebuttal_node(agent))
        g.add_edge("red_team", node)
        g.add_edge(node, "judge")
    g.add_node("judge", judge)
    g.add_node("aggregate", aggregate)
    g.add_edge("judge", "aggregate")
    g.add_edge("aggregate", END)
    return g.compile()
