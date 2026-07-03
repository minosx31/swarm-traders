"""The fixed two-turn debate graph (ARCHITECTURE §2): topology wiring only.

    START ─┬─ fundamentals ─┐
           ├─ sentiment     ├─ red_team ─┬─ rebuttal_fundamentals ─┐
           └─ technicals   ─┘            ├─ rebuttal_sentiment     ├─ judge ─ aggregate ─ END
                                         └─ rebuttal_technicals   ─┘

A fixed linear sequence with parallel fan-out/fan-in — no convergence loop.
Node behaviour lives in agents.py; this module only wires it.
"""

import operator
from typing import Annotated, TypedDict

from langgraph.graph import END, START, StateGraph

from .agents import SPECIALISTS, aggregate, judge, make_rebuttal_node, make_specialist_node, red_team


class Blackboard(TypedDict):
    """Shared state. Lists merge via operator.add so parallel fan-out is safe.
    Carries summarized theses + grounded evidence only, never raw reasoning."""

    ticker: str
    as_of: str
    theses: Annotated[list[dict], operator.add]
    attacks: Annotated[list[dict], operator.add]
    rebuttals: Annotated[list[dict], operator.add]
    adjudicated_stances: Annotated[list[dict], operator.add]


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
