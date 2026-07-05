# LLM access goes through LangChain chat models

**Status:** accepted

Every LLM call goes through a LangChain chat model — `ChatOllama` (dev) or
`ChatAnthropic` (demo), selected by the `LLM_BACKEND` flag — rather than a
hand-rolled `llm_complete()` wrapper over the raw provider SDKs. This reverses
PLAN's "thin ~20 min wrapper" line. `langchain-core` is already in the tree
(LangGraph pulls it), so this adds no new dependency. Three things hang off it:
tool-calling, structured output, and the budget safeguards.

## Why

The plan's "~20 min wrapper" estimate is priced for the *no-tools* completion
path, where it is roughly right. But the headline agentic feature (ADR 0003) is
the tool-calling debate loop, and tool-calling is exactly where Ollama and
Anthropic diverge most: different tool-result message threading, different content
shapes, different loop bookkeeping. Hand-normalizing both — the fiddliest, flakiest
code in the build — is not a 20-minute job, and if that estimate slips, Day 4
slips. LangChain's `ChatAnthropic` and `ChatOllama` already implement
`.bind_tools()` and return a normalized `AIMessage.tool_calls` across providers.
That normalization is the exact hard part, already shipped in code we depend on
anyway.

## Consequences

- **Tool loop:** `.bind_tools([...])` gives one provider-agnostic tool interface;
  the 2–3 iteration cap (ADR 0003) wraps the loop.
- **Structured output, split by node type:** no-tool thesis nodes use
  `.with_structured_output(Thesis)`; tool-using debate nodes cannot — that
  coercion is itself a forced tool call and collides with the real tools — so they
  instead expose a terminal `submit_rebuttal` / `submit_attack` tool whose argument
  schema *is* the Pydantic model, and treat "model called `submit_*`" as the exit.
  Both paths get a single validation-retry on the local backend, where structured
  output does not reliably self-heal.
- **Budget safeguards move to a callback:** the `max_calls` circuit breaker and the
  cost logger can no longer live "in the provider wrapper" (there isn't one). They
  become a single `BaseCallbackHandler` attached globally — `on_llm_start` counts
  calls and raises `BreakerTripped` past the cap; `on_llm_end` accumulates token
  cost and reads Anthropic `cache_read`/`cache_creation` counts for real cache
  accounting. Centralized and un-bypassable, unlike a per-node counter. The trip is
  caught at the SSE boundary (ADR 0004).
- **Backend/model is selectable per-run, not just per-launch.** `LLM_BACKEND` (+
  `OLLAMA_MODEL`) is now the *default*; a live `/stream?backend=&model=` request
  overrides it for that run via a `contextvars` override (`llm.set_run_override`)
  set by the runner before the graph task is created, so it rides the asyncio task
  into every nested call and the `save_run` model tag — no param threaded through
  each node. This refines, not breaks, "never switch mid-run": the override is
  fixed for a run's duration; only *between* runs can it change. The UI lists
  choices from `GET /models` (installed Ollama models via the local daemon; the
  paid Claude options only when `ANTHROPIC_API_KEY` is set). Run logs carry their
  model in both filename and payload, so replay can pick a run by model
  (`GET /runs`, `/stream?replay=1&run=`).
- We are coupled to LangChain message objects internally; this never reaches the
  SSE contract, which is owned by the queue (ADR 0004).
- LangChain normalizes the tool-call *format*, not model *reliability* — Qwen still
  emits malformed calls, so defensive parsing on the local path stays necessary.

## Rejected

- **Hand-rolled `llm_complete_with_tools()`:** full control of the raw message
  format, but re-implements provider-specific tool threading that LangChain already
  solves, and mis-prices the build's riskiest code as trivial.
- **`instructor` for structured output:** patches raw SDK clients, which fights the
  LangChain chat-model path and would mean two competing abstractions over the same
  call.
