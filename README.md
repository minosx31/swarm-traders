# Alpha Swarms

A swarm of specialist AI agents that independently research a stock, debate each
other adversarially, and deliver a conviction-scored verdict backed by cited
evidence and the strongest opposing view — *"a research analyst that never skips
the bear case."*

You give the system a `(ticker, as_of)` pair backed by a curated point-in-time
data snapshot. Three specialists (Fundamentals, Sentiment, Technicals) assert
theses, a Red-Team attacks them, each specialist gets one rebuttal, a Judge rules
which attacks landed, and a computed aggregate produces the Verdict (or an honest
No Call). The debate streams live over SSE, one event per agent step.

**Status:** Phases 0–3 complete. The full debate pipeline runs end-to-end on the
free Ollama backend (pre-sliced #6 baseline); every run is recorded to a
replayable JSON event log (#9), and the React frontend renders live or replayed
debates in per-agent lanes. The debate-phase tool-calling increment (#8,
`DEBATE_TOOLS=1`) lets the Red-Team and rebuttal agents autonomously fetch
cached, as-of-filtered evidence to attack/defend, streaming `tool_call` /
`tool_result` events into the lanes. Tool-mode is **off by default** — the local
qwen models fetch reliably but don't consistently emit the nested `submit_*`
exit, so it's tuned for the capable demo backends (ADR 0003 graceful fallback:
the default free-backend path is the unchanged baseline). Next: the Sonnet demo
pass (#10–#11). See `issues.md` for the build plan and progress.

---

## Repository layout

### Design docs (read these first)

| File | What it is |
|---|---|
| `PLAN.md` | The 1-week build plan: problem, architecture, budget strategy ($15 hard limit), day-by-day order |
| `ARCHITECTURE.md` | Consolidated technical design: system diagram, agent graph, SSE event contract (§3), scoring pipeline, safeguards |
| `CONTEXT.md` | Domain glossary — the shared vocabulary (Thesis, Stance, Grounded Evidence, No Call, …) |
| `issues.md` | The build broken into 11 tracer-bullet slices with acceptance criteria; checkboxes track progress |
| `docs/adr/0001–0005` | Decision records: advocacy/adjudication split, point-in-time integrity, tools-over-cached-data, event queue over LangGraph `.stream()`, LangChain chat models |

### Backend (`backend/`)

One FastAPI app with LangGraph running in-process — nothing else to host.

| File | What it does |
|---|---|
| `alpha_swarms/app.py` | FastAPI app. `GET /stream?ticker&as_of[&replay=1]` — refuses non-whitelisted pairs with `400`, streams the debate (or a recorded run) as SSE. Also `GET /whitelist` and `GET /outcome` (UI-facing). Validates `LLM_BACKEND` at startup |
| `alpha_swarms/replay.py` | Record + replay (#9): every run's event log persists to `data/runs/`; replay re-streams the latest log with the graph bypassed — zero LLM calls |
| `alpha_swarms/graph.py` | LangGraph topology wiring: parallel specialist fan-out → red_team → parallel rebuttals → judge → aggregate, plus the reducer-merged `Blackboard` state |
| `alpha_swarms/agents.py` | The LLM-backed nodes: specialist/Red-Team/rebuttal/Judge prompts + the structured-output helper (one validation-retry, then graceful failure). Pre-sliced single calls; the Red-Team/rebuttal nodes switch to the bounded tool-calling loop when `DEBATE_TOOLS=1` (#8) |
| `alpha_swarms/tools.py` | Debate-phase tool-calling (#8, ADR 0003): `get_financials`/`get_price_history`/`get_news` read tools over the cached Snapshot with the As-Of filter enforced *inside* the tool (leakage impossible by construction), plus the terminal `submit_attack`/`submit_rebuttal` exit tools whose arg schema *is* the Pydantic model (ADR 0005). Gated behind `DEBATE_TOOLS` |
| `alpha_swarms/models.py` | Pydantic schemas the models must produce: Thesis, Evidence (numeric/textual tiers), Attack, Rebuttal, JudgeRuling |
| `alpha_swarms/slices.py` | Pre-sliced per-specialist context (flattened statements, derived price metrics, cached news) + the citation key space grounding resolves against |
| `alpha_swarms/grounding.py` | The deterministic grounding gate (ADR 0001): numeric citation_key + value-match, textual source_id resolution, Verified Quote badge, ≥1 grounded item to vote |
| `alpha_swarms/scoring.py` | Pure-Python Verdict: mean of adjudicated stances → direction bands / conviction / dissent / quorum No-Call. Never authored by the Judge |
| `alpha_swarms/events.py` | The display-event channel (ADR 0004): per-run `asyncio.Queue` the nodes emit typed events into; the endpoint drains it with the inter-event delay |
| `alpha_swarms/runner.py` | Run lifecycle: owns the queue, attaches the safeguards handler globally, catches mid-graph failures and surfaces them as a terminal `error` event |
| `alpha_swarms/llm.py` | Provider abstraction (ADR 0005): `LLM_BACKEND` env flag picks a LangChain chat model (`ollama` / `groq` / `haiku` / `sonnet`); wires Anthropic `cache_control` for system prompts |
| `alpha_swarms/safeguards.py` | Budget safeguards: circuit breaker (kills a run past 15 LLM calls), per-run cost estimate incl. cache accounting, persistent global spend counter (`data/spend.json`) |
| `alpha_swarms/snapshot.py` | Point-in-time Snapshot layer (ADR 0002): Pydantic models, the leak validator (no datum dated after as-of), whitelist (= snapshot files on disk), loader that never touches Outcomes |
| `scripts/build_snapshot.py` | Offline ingestion: builds `data/snapshots/{TICKER}_{AS_OF}.json` from yfinance (prices, last *reported* fundamentals, news) plus the held-out Outcome in `data/outcomes/`. Never runs during a request |
| `scripts/pretty_print.py` | Terminal client: consumes the SSE stream and renders the debate with per-agent colors (the pre-React fallback UI) |
| `tests/` | Acceptance tests per issue: `test_safeguards.py` (#2), `test_snapshot.py` (#3), `test_debate.py` (#4/#6, scripted LLM), `test_grounding.py` (#5), `test_scoring.py` (#6), `test_tools.py` (#8, tool-calling + as-of leakage property) |
| `data/snapshots/` | Whitelisted point-in-time snapshots — the only data agents ever see |
| `data/outcomes/` | What actually happened after as-of. Held out of agent-visible state; the UI reveals it only after the Verdict |

### Frontend (`frontend/`)

React + Vite + TypeScript + Tailwind v4 static site (Bun tooling). Dark
"terminal courtroom" design; the agent palette is CVD-validated.

| File | What it does |
|---|---|
| `src/types.ts` | TypeScript mirror of the SSE event contract |
| `src/reducer.ts` | `useReducer` over the event union, keyed by agent — unknown events never crash it |
| `src/useDebateStream.ts` | `EventSource` lifecycle: dispatches events, closes on the terminal event |
| `src/api.ts` | Backend base URL (`VITE_API_BASE`), whitelist + outcome fetches |
| `src/components.tsx` | Atoms: agent chips, signed stance meters, evidence rows (grounded/dropped, Verified Quote badge) |
| `src/Lane.tsx` | One specialist's column: thesis → attacks on it → rebuttal → adjudication (the stance trail) |
| `src/VerdictPanel.tsx` | Verdict stamp, conviction+N+dissent (never conviction alone), landed attacks, post-verdict Outcome reveal |
| `src/*.test.ts(x)` | `bun test`: reducer contract tests + DOM render of a real recorded run |

---

## Setup

Prereqs: [uv](https://docs.astral.sh/uv/), and [Ollama](https://ollama.com/)
with a local model for free dev runs (currently `qwen3.5:9b`; override via
`OLLAMA_MODEL`).

```bash
cd backend
uv sync                                            # install deps into .venv
```

Whitelist a `(ticker, as_of)` pair by building its snapshot (offline, one-time):

```bash
uv run scripts/build_snapshot.py AAPL 2026-06-30
```

Run the backend, and the frontend in a second terminal:

```bash
LLM_BACKEND=ollama uv run uvicorn alpha_swarms.app:app --reload   # http://localhost:8000
cd frontend && bun install && bun run dev                          # http://localhost:5173
```

Pick a whitelisted pair in the UI and hit **Convene Swarm** (a live run on the
local model takes a few minutes; check **Replay** to re-stream the last recorded
run instantly at $0). The terminal fallback renders the same stream:

```bash
uv run scripts/pretty_print.py --ticker AAPL --as-of 2026-06-30
```

Run the tests:

```bash
uv run pytest
```

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `LLM_BACKEND` | Picks the chat model: `ollama` \| `groq` \| `haiku` \| `sonnet`. Required for real runs (`LLM_BACKEND=ollama` for free dev). Never switch mid-run | unset |
| `OLLAMA_MODEL` | Local model for the `ollama` backend | `qwen3.5:9b` |
| `DEBATE_TOOLS` | Enable the debate-phase tool-calling increment (#8): Red-Team + rebuttals fetch cached evidence via tools. Off = the pre-sliced #6 baseline | unset (off) |
| `RESILIENT` | When set, a debate node whose LLM output fails *abstains* (contributes nothing) so the run still reaches a verdict, instead of aborting with a terminal `error`. Set it when recording local demo takes on the flaky local models; leave off for the honest fail-loud default. The budget breaker always stays loud | unset (off) |
| `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | Provider keys, needed only for their backends | — |
| `EVENT_DELAY_S` | Inter-event delay on the SSE stream (readability) | `0.25` |
| `SNAPSHOT_DIR` | Snapshot/whitelist location | `backend/data/snapshots` |
| `RUNS_DIR` | Recorded run logs (replay reads the latest per pair) | `backend/data/runs` |
| `SPEND_FILE` | Persistent global spend counter | `backend/data/spend.json` |
| `VITE_API_BASE` | Frontend → backend base URL | `http://localhost:8000` |

**Budget guardrails are always on:** every run is capped at 15 LLM calls, prints
its estimated cost, and accumulates into the global counter — treat $15 as a wall.
