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

**Status:** Phase 0 complete (walking skeleton + budget safeguards + snapshot
layer). The debate graph currently runs on mock agents; real specialists land in
Phase 1. See `issues.md` for the build plan and progress.

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
| `alpha_swarms/app.py` | FastAPI app. `GET /stream?ticker&as_of` — refuses non-whitelisted pairs with `400`, otherwise streams the debate as SSE. Validates `LLM_BACKEND` at startup |
| `alpha_swarms/graph.py` | The LangGraph debate graph: parallel specialist fan-out → red_team → parallel rebuttals → judge → pure-Python aggregate. Nodes are currently mocks emitting hardcoded events (Phase 1 replaces them) |
| `alpha_swarms/events.py` | The display-event channel (ADR 0004): per-run `asyncio.Queue` the nodes emit typed events into; the endpoint drains it with the inter-event delay |
| `alpha_swarms/runner.py` | Run lifecycle: owns the queue, attaches the safeguards handler globally, catches mid-graph failures and surfaces them as a terminal `error` event |
| `alpha_swarms/llm.py` | Provider abstraction (ADR 0005): `LLM_BACKEND` env flag picks a LangChain chat model (`ollama` / `groq` / `haiku` / `sonnet`); wires Anthropic `cache_control` for system prompts |
| `alpha_swarms/safeguards.py` | Budget safeguards: circuit breaker (kills a run past 15 LLM calls), per-run cost estimate incl. cache accounting, persistent global spend counter (`data/spend.json`) |
| `alpha_swarms/snapshot.py` | Point-in-time Snapshot layer (ADR 0002): Pydantic models, the leak validator (no datum dated after as-of), whitelist (= snapshot files on disk), loader that never touches Outcomes |
| `scripts/build_snapshot.py` | Offline ingestion: builds `data/snapshots/{TICKER}_{AS_OF}.json` from yfinance (prices, last *reported* fundamentals, news) plus the held-out Outcome in `data/outcomes/`. Never runs during a request |
| `scripts/pretty_print.py` | Terminal client: consumes the SSE stream and renders the debate with per-agent colors (the pre-React fallback UI) |
| `tests/` | Acceptance tests per issue: `test_walking_skeleton.py` (#1), `test_safeguards.py` (#2), `test_snapshot.py` (#3) |
| `data/snapshots/` | Whitelisted point-in-time snapshots — the only data agents ever see |
| `data/outcomes/` | What actually happened after as-of. Held out of agent-visible state; the UI reveals it only after the Verdict |

### Frontend

Not built yet — Phase 2 (`issues.md` #7) adds a React + Vite + Tailwind static
site with live per-agent lanes over the same SSE stream.

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

Run the backend and watch a (mock, for now) debate in a second terminal:

```bash
uv run uvicorn alpha_swarms.app:app --reload       # http://localhost:8000
uv run scripts/pretty_print.py --ticker AAPL --as-of 2026-06-30
```

Run the tests:

```bash
uv run pytest
```

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `LLM_BACKEND` | Picks the chat model: `ollama` \| `groq` \| `haiku` \| `sonnet`. Unused by the mock graph; required from Phase 1. Never switch mid-run | unset |
| `OLLAMA_MODEL` | Local model for the `ollama` backend | `qwen3.5:9b` |
| `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | Provider keys, needed only for their backends | — |
| `EVENT_DELAY_S` | Inter-event delay on the SSE stream (readability) | `0.25` |
| `SNAPSHOT_DIR` | Snapshot/whitelist location | `backend/data/snapshots` |
| `SPEND_FILE` | Persistent global spend counter | `backend/data/spend.json` |

**Budget guardrails are always on:** every run is capped at 15 LLM calls, prints
its estimated cost, and accumulates into the global counter — treat $15 as a wall.
