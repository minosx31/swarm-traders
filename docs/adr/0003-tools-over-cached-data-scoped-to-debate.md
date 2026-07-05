# Agents use tools, but tools read cached point-in-time data, and tool-calling is scoped to the debate

**Status:** accepted

Specialists are genuinely tool-calling agents, but their tools read only the
curated point-in-time **Snapshot** (with the As-Of Date enforced inside the tool),
never live APIs. Tool use is scoped: a specialist's **initial thesis** runs off a
pre-sliced context in a single call (no tools); **rebuttals** (and optionally the
Red-Team) may call tools to dig up additional cached evidence. The pre-sliced
pipeline is built first; tool-calling layers on top of it.

## Why

This is an agentic-AI hackathon, so a system with zero tool use reads as a pipeline
in an agent costume — visible autonomy is rewarded. But live tools would both leak
future data (breaking [ADR 0002](0002-point-in-time-integrity.md)) and burn the
the API budget unpredictably. Tools over cached data give real, dynamic tool-calling
with $0 live cost, full reproducibility for replay runs, and leakage that is
*impossible by construction* (the tool cannot return anything after the As-Of
Date). Scoping tools to the debate concentrates the extra cost and the model
reliability risk exactly where the agentic payoff is highest and most watchable —
a challenged agent autonomously fetching data to defend itself — while keeping the
bulk of the run cheap.

## Consequences

- Tool-calling is multi-turn, so per-run cost roughly doubles vs pre-sliced (~10–12
  calls). Raise the circuit breaker to ~15 and cap tool iterations at 2–3 per agent.
- Two code paths (pre-sliced thesis, tool-using debate) sharing one data-access
  layer; grounding simplifies because tool returns are grounded by construction.
- New SSE event types (`tool_call`, `tool_result`) double as the live-debate visuals.
- Tool-calling is flaky on the local Ollama dev models; expect to re-tune for Sonnet.
- **Graceful fallback:** because C = pre-sliced (A) + an increment, if Sonnet
  tool-tuning runs out of time the system degrades to the pre-sliced pipeline and
  still ships a complete demo.

## Rejected

- **Live tools:** leak future data and spend unbudgeted credits mid-demo.
- **Tools everywhere (including initial theses):** ~2× cost, trips the breaker, and
  spreads reliability risk across every call for little added demo value.
- **No tools at all (pure pre-sliced):** cheapest and most reproducible, but weak
  agentic optics at an agentic hackathon.
