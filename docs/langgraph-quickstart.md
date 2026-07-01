# LangGraph Quickstart (Alpha Swarms)

LangGraph is the **orchestration layer** — and it is *just a library*, not a
service. Nothing to deploy, host, or containerize: `pip install langgraph`,
`import` it, and it runs inside the FastAPI process. Its job here: hold the
shared blackboard (state), run each agent as a node, drive the fixed debate
sequence (specialists → red-team → rebuttals → judge), and — the payoff — its
`.stream()` yields state after every node, which is exactly what you relay as SSE
events. See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §2 for the full graph.

## 1. Install

```bash
python -m venv .venv && source .venv/bin/activate
pip install langgraph          # pulls langchain-core; no server, just a lib
pip install ollama             # dev provider (free, local)
pip install anthropic          # demo provider (paid, swap in later)
```

## 2. The three concepts

- **State** = a `TypedDict`, your blackboard. Nodes return a *partial* update, not the whole state.
- **Node** = a plain function `state -> {partial update}`. Each agent is one node.
- **Edge** = control flow. Multiple edges out of `START` = parallel fan-out;
  multiple edges *into* a node = fan-in (it waits for all of them).

## 3. A minimal, runnable version of the swarm

```python
# graph.py
import operator
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END

# STATE — `theses` is written by 3 parallel nodes, so it needs a *reducer* that
# MERGES concurrent updates (append) instead of overwriting. #1 fan-out gotcha.
class SwarmState(TypedDict):
    ticker: str
    theses: Annotated[list, operator.add]      # reducer: parallel appends merge
    attacks: Annotated[list, operator.add]
    verdict: dict

# NODES — real code calls llm_complete(...); mocked here so it runs free.
def fundamentals(state): return {"theses": [{"agent": "fundamentals", "stance": 0.6}]}
def sentiment(state):    return {"theses": [{"agent": "sentiment",    "stance": -0.2}]}
def technicals(state):   return {"theses": [{"agent": "technicals",   "stance": 0.4}]}

def red_team(state):
    return {"attacks": [{"target": t["agent"], "kind": "logical"} for t in state["theses"]]}

def judge(state):  # the aggregate is PURE PYTHON — not an LLM (ADR 0001)
    stances = [t["stance"] for t in state["theses"]]
    agg = sum(stances) / len(stances)
    direction = "bull" if agg > 0.25 else "bear" if agg < -0.25 else "neutral"
    return {"verdict": {"aggregate_stance": round(agg, 2), "direction": direction}}

# WIRE IT
b = StateGraph(SwarmState)
for name, fn in [("fundamentals", fundamentals), ("sentiment", sentiment),
                 ("technicals", technicals), ("red_team", red_team), ("judge", judge)]:
    b.add_node(name, fn)

for s in ("fundamentals", "sentiment", "technicals"):
    b.add_edge(START, s)        # fan-out: 3 specialists run in parallel
    b.add_edge(s, "red_team")   # fan-in: red_team waits for all 3
b.add_edge("red_team", "judge")
b.add_edge("judge", END)

graph = b.compile()

if __name__ == "__main__":
    # .stream() yields after each node — THESE become your SSE events
    for step in graph.stream(
        {"ticker": "NVDA", "theses": [], "attacks": []}, stream_mode="updates"
    ):
        print(step)
```

```bash
python graph.py
```

One dict prints per node as it completes — that per-node yield *is* the
live-debate feed.

## 4. Wiring `.stream()` into FastAPI SSE

FastAPI is async, so use **`astream`** (the async variant):

```python
from sse_starlette.sse import EventSourceResponse
import json

@app.get("/stream")
async def stream(ticker: str, as_of: str):
    async def gen():
        async for step in graph.astream(
            {"ticker": ticker, "as_of": as_of, "theses": [], "attacks": []},
            stream_mode="updates",
        ):
            yield {"data": json.dumps(step)}
    return EventSourceResponse(gen())
```

## 5. Visualizing the graph

A compiled graph exposes `.get_graph()`, which can render itself. Pick by need:

```python
g = graph.get_graph()

# (a) ASCII — instant, terminal-friendly. Needs: pip install grandalf
g.print_ascii()

# (b) Mermaid text — paste into mermaid.live or any Markdown that renders Mermaid.
print(g.draw_mermaid())

# (c) PNG bytes via the mermaid.ink API (needs internet). Write to a file:
with open("graph.png", "wb") as f:
    f.write(g.draw_mermaid_png())

# (d) Local PNG via Graphviz (offline). Needs system graphviz + pip install pygraphviz
with open("graph.png", "wb") as f:
    f.write(g.draw_png())

# In a Jupyter notebook, display inline:
# from IPython.display import Image; Image(g.draw_mermaid_png())
```

**Which to use:** `print_ascii()` for a quick wiring check while coding;
`draw_mermaid()` to drop a diagram into these docs (no image files to manage);
`draw_png()` (Graphviz) if you want a polished offline image for the demo.
Note `draw_mermaid_png()` calls the remote mermaid.ink service — avoid it on an
offline demo machine; prefer the Graphviz path or paste the Mermaid text into
<https://mermaid.live>.

## The two things that trip people up

1. **Parallel writes need a reducer.** Without `Annotated[list, operator.add]`,
   three specialists writing `theses` at once throw a concurrent-update error.
2. **Nodes return partial updates**, not the full state — return only the keys
   you changed; LangGraph merges them in.

`stream_mode="updates"` gives *what each node changed* (ideal for per-agent SSE
events); `stream_mode="values"` gives the *full state* after each step (handy for
debugging).
