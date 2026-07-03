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

**Status:** Phases 0–1 complete. The full debate pipeline — three real
specialists, Red-Team, rebuttals, Judge, computed Verdict, deterministic
grounding gate — runs end-to-end on the free Ollama backend (pre-sliced
baseline, no tools yet). Next: the React frontend (Phase 2) and debate-phase
tool-calling (Phase 3). See `issues.md` for the build plan and progress.

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
| `alpha_swarms/graph.py` | LangGraph topology wiring: parallel specialist fan-out → red_team → parallel rebuttals → judge → aggregate, plus the reducer-merged `Blackboard` state |
| `alpha_swarms/agents.py` | The LLM-backed nodes: specialist/Red-Team/rebuttal/Judge prompts + the structured-output helper (one validation-retry, then graceful failure). Pre-sliced single calls, no tools (ADR 0003 baseline) |
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
| `tests/` | Acceptance tests per issue: `test_safeguards.py` (#2), `test_snapshot.py` (#3), `test_debate.py` (#4/#6, scripted LLM), `test_grounding.py` (#5), `test_scoring.py` (#6) |
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

Run the backend and watch a live debate in a second terminal (a full run on the
local model takes a few minutes):

```bash
LLM_BACKEND=ollama uv run uvicorn alpha_swarms.app:app --reload   # http://localhost:8000
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
| `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | Provider keys, needed only for their backends | — |
| `EVENT_DELAY_S` | Inter-event delay on the SSE stream (readability) | `0.25` |
| `SNAPSHOT_DIR` | Snapshot/whitelist location | `backend/data/snapshots` |
| `SPEND_FILE` | Persistent global spend counter | `backend/data/spend.json` |

**Budget guardrails are always on:** every run is capped at 15 LLM calls, prints
its estimated cost, and accumulates into the global counter — treat $15 as a wall.
