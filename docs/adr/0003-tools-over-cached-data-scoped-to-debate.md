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
  *(Later adopted behind the same `DEBATE_TOOLS` flag — see the Addendum.)*
- **No tools at all (pure pre-sliced):** cheapest and most reproducible, but weak
  agentic optics at an agentic hackathon.

## Addendum (2026-07-09): specialists research on tools too

The initial scoping kept **initial theses pre-sliced** and rejected "tools
everywhere" on cost/breaker grounds. We are now extending tool-calling to the
specialists behind the *same* `DEBATE_TOOLS` flag: when it is on, each specialist
is given exactly its **own lane's read tool** and researches its initial thesis
autonomously (fetch → read → submit) rather than being handed a pre-sliced block.

**Why revisit.** The pre-sliced specialist is the least agentic node in the graph
— an LLM being *prompted*, not an agent *directing its own process*. Making the
specialist choose what to pull is the cleanest place to earn genuine agency: it
turns "independent research" into actual research, and it is the strongest
demo/pitch beat with the lowest risk, because it touches no integrity guarantee.
The grounding gate, the advocacy/adjudication split, and the computed verdict are
all unchanged — a tool return still flows through the deterministic gate.

**Lane isolation is preserved.** A specialist gets a single lane tool
(`make_specialist_tools`), so it can only fetch — and therefore only cite — its
own lane, exactly the property the pre-sliced slice gave it.

**The two original objections, resolved:**
- *Cost / breaker.* Each specialist is capped at **2 tool iterations** (one
  research turn, then a forced submit), so the tool-mode worst case is ≤19 calls
  (3×2 specialists + 3 red-team + 3×3 rebuttals + 1 judge). We raised the circuit
  breaker from 15 to **20** to backstop it — the ADR's own "raise the breaker"
  consequence, applied again. The pre-sliced default is untouched at ~8 calls.
- *Reliability.* Still real on capable models and flaky on local ones — but the
  flag stays **off by default**, so the reproducible pre-sliced baseline remains
  the default path and every recorded run reproduces unchanged.
