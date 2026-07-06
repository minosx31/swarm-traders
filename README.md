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

Built for the professional analyst — augmentation, not replacement: bring a
thesis, let the swarm **stress-test** it. The guarantees are structural, not
prompted: specialists think in parallel with no shared context; every claim must
cite and value-match the point-in-time snapshot or it is dropped (a hallucinated
citation costs the specialist its vote); the Red-Team's attacks are held to the
same grounding bar; the verdict is *computed*, never authored by any model; and
when fewer than two specialists clear the grounding gate, the system says
**No Call** instead of faking confidence. You can't prompt away confirmation
bias — you have to structure it away. (Full pitch strategy: `docs/pitch.md`.)

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

## Data sources & point-in-time integrity

All data is fetched into a curated **Snapshot** *before* any agent runs — agents
never touch a live API (ADR 0002, 0006). Every datum carries an availability
date, and a snapshot refuses to save if anything post-dates the as-of date.

| Data | Source | Point-in-time rule |
|---|---|---|
| Prices | Yahoo Finance (yfinance) | 1 year of daily OHLCV, dated ≤ as-of |
| Fundamentals | Yahoo Finance quarterly income statement + balance sheet | only the last quarter *reported* before as-of; availability stamped period-end + 45 days (the 10-Q deadline), so an ended-but-unfiled quarter cannot leak |
| News | Finnhub company-news API — historical, date-ranged, stable IDs (`FINNHUB_API_KEY`); yfinance current headlines as fallback | 30-day lookback, capped at 50 items, publish date ≤ as-of |
| Outcome | yfinance, 30 days *after* as-of | held in a separate file nothing on the run path reads; the UI reveals it only after the Verdict |

Free-tier sources are a scope choice, not architecture: the Snapshot schema is
the vendor abstraction, so a licensed feed (Polygon / FMP / Refinitiv) is one
fetcher function per source — the grounding, citation, and leak-check machinery
are unchanged.

---

## Repository layout

### Design docs (read these first)

| File | What it is |
|---|---|
| `PLAN.md` | The 1-week build plan: problem, architecture, cost strategy, day-by-day order |
| `ARCHITECTURE.md` | Consolidated technical design: system diagram, agent graph, SSE event contract (§3), scoring pipeline, safeguards |
| `CONTEXT.md` | Domain glossary — the shared vocabulary (Thesis, Stance, Grounded Evidence, No Call, …) |
| `issues.md` | The build broken into 12 tracer-bullet slices with acceptance criteria; checkboxes track progress |
| `docs/adr/0001–0006` | Decision records: advocacy/adjudication split, point-in-time integrity, tools-over-cached-data, event queue over LangGraph `.stream()`, LangChain chat models, on-demand snapshot build |
| `docs/pitch.md` | Pitch strategy: target persona, differentiation, demo spine + run-of-show, data provenance, business model, real-time roadmap, Q&A bank |

### Backend (`backend/`)

One FastAPI app with LangGraph running in-process — nothing else to host.

| File | What it does |
|---|---|
| `alpha_swarms/app.py` | FastAPI app. `GET /stream?ticker&as_of[&replay=1][&backend=&model=][&run=]` — refuses non-whitelisted pairs with `400`, streams the debate (or a recorded run) as SSE; `backend`/`model` pin the LLM for a live run, `run` selects which recording to replay. `POST /snapshots` builds a missing pair on demand (ADR 0006; an existing pair is reused, never re-fetched). Also `GET /whitelist`, `GET /outcome`, `GET /models` (selectable models), `GET /runs?ticker&as_of` (recorded runs, for replay-by-model) — all UI-facing. Validates `LLM_BACKEND` at startup |
| `alpha_swarms/replay.py` | Record + replay (#9): every run's event log persists to `data/runs/` with its model in the filename + payload; replay re-streams a chosen run (or the latest) with the graph bypassed — zero LLM calls |
| `alpha_swarms/graph.py` | LangGraph topology wiring: parallel specialist fan-out → red_team → parallel rebuttals → judge → aggregate, plus the reducer-merged `Blackboard` state |
| `alpha_swarms/agents.py` | The LLM-backed nodes: specialist/Red-Team/rebuttal/Judge prompts + the structured-output helper (one validation-retry, then graceful failure). Pre-sliced single calls; the Red-Team/rebuttal nodes switch to the bounded tool-calling loop when `DEBATE_TOOLS=1` (#8) |
| `alpha_swarms/tools.py` | Debate-phase tool-calling (#8, ADR 0003): `get_financials`/`get_price_history`/`get_news` read tools over the cached Snapshot with the As-Of filter enforced *inside* the tool (leakage impossible by construction), plus the terminal `submit_attack`/`submit_rebuttal` exit tools whose arg schema *is* the Pydantic model (ADR 0005). Gated behind `DEBATE_TOOLS` |
| `alpha_swarms/models.py` | Pydantic schemas the models must produce: Thesis, Evidence (numeric/textual tiers), Attack, Rebuttal, JudgeRuling |
| `alpha_swarms/slices.py` | Pre-sliced per-specialist context (flattened statements, derived price metrics, cached news) + the citation key space grounding resolves against |
| `alpha_swarms/grounding.py` | The deterministic grounding gate (ADR 0001): numeric citation_key + value-match, textual source_id resolution, Verified Quote badge, ≥1 grounded item to vote |
| `alpha_swarms/scoring.py` | Pure-Python Verdict: mean of adjudicated stances → direction bands / conviction / dissent / quorum No-Call. Never authored by the Judge |
| `alpha_swarms/events.py` | The display-event channel (ADR 0004): per-run `asyncio.Queue` the nodes emit typed events into; the endpoint drains it with the inter-event delay |
| `alpha_swarms/runner.py` | Run lifecycle: owns the queue, attaches the safeguards handler globally, catches mid-graph failures and surfaces them as a terminal `error` event |
| `alpha_swarms/llm.py` | Provider abstraction (ADR 0005): `LLM_BACKEND` env flag picks the *default* LangChain chat model (`ollama` / `groq` / `haiku` / `sonnet`); a live request can override backend+model per-run via a contextvar. `available_models()` lists choices for the UI; wires Anthropic `cache_control` for system prompts |
| `alpha_swarms/safeguards.py` | Budget safeguards: circuit breaker (kills a run past 15 LLM calls), per-run cost estimate incl. cache accounting, persistent global spend counter (`data/spend.json`) |
| `alpha_swarms/snapshot.py` | Point-in-time Snapshot layer (ADR 0002): Pydantic models, the leak validator (no datum dated after as-of), whitelist (= snapshot files on disk), loader that never touches Outcomes |
| `alpha_swarms/ingest.py` | Snapshot ingestion (ADR 0006): prices + last *reported* fundamentals from yfinance, date-ranged historical news from Finnhub (`FINNHUB_API_KEY`; yfinance current-news fallback), leak-validated and persisted with the held-out Outcome. Runs via the CLI or `POST /snapshots` — always completes before any agent runs |
| `scripts/build_snapshot.py` | Offline ingestion CLI: thin wrapper over `alpha_swarms/ingest.py`; builds `data/snapshots/{TICKER}_{AS_OF}.json` plus `data/outcomes/` |
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
| `src/api.ts` | Backend base URL (`VITE_API_BASE`), whitelist + outcome fetches, snapshot build-if-missing |
| `src/components.tsx` | Atoms: agent chips, signed stance meters, the evidence ledger (grounded foregrounded, failed citations collapsed) + validation badge |
| `src/Provenance.tsx` | The data-provenance manifest strip: snapshot in play, grounded ratio across lanes, voting lenses (what the swarm is working from) |
| `src/Lane.tsx` | One specialist's column: thesis → attacks on it → rebuttal → adjudication (the stance trail) |
| `src/VerdictPanel.tsx` | Verdict stamp, conviction+N+dissent (never conviction alone), landed attacks, post-verdict Outcome reveal |
| `src/*.test.ts(x)` | `bun test`: reducer contract tests + DOM render of a real recorded run |

---

## Setup

Prereqs: [uv](https://docs.astral.sh/uv/), and [Ollama](https://ollama.com/)
with a local model for free dev runs (default `qwen2.5:7b`; override via
`OLLAMA_MODEL`).

```bash
cd backend
uv sync                                            # install deps into .venv
```

Put API keys in `backend/.env` (auto-loaded by the app and the CLI):

```bash
cp .env.example .env    # then paste your FINNHUB_API_KEY
```

`FINNHUB_API_KEY` (free key at [finnhub.io](https://finnhub.io)) sources
date-ranged historical news for the as_of window; without it, news falls back to
yfinance current headlines.

A `(ticker, as_of)` pair gets its snapshot built automatically the first time you
convene it from the UI (ADR 0006) and is cached on disk for every later run. To
pre-build or rebuild one from the terminal:

```bash
uv run scripts/build_snapshot.py AAPL 2026-06-30
```

Run the backend, and the frontend in a second terminal:

```bash
LLM_BACKEND=ollama uv run uvicorn alpha_swarms.app:app --reload   # http://localhost:8000
cd frontend && bun install && bun run dev                          # http://localhost:5173
```

Pick a pair in the UI and hit **Convene Swarm** — an uncached pair builds its
snapshot first, then the debate starts (a live run on the local model takes a
few minutes; check **Replay** to re-stream the last recorded run instantly at
$0). The terminal fallback renders the same stream:

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
| `LLM_BACKEND` | *Default* chat model: `ollama` \| `groq` \| `haiku` \| `sonnet`. Required at startup (`LLM_BACKEND=ollama` for free dev). The UI can override backend+model per live run (`GET /models`); a run never switches model mid-flight | unset |
| `OLLAMA_MODEL` | Default local model for the `ollama` backend (the UI model dropdown overrides it per-run) | `qwen2.5:7b` |
| `DEBATE_TOOLS` | Enable the debate-phase tool-calling increment (#8): Red-Team + rebuttals fetch cached evidence via tools. Off = the pre-sliced #6 baseline | unset (off) |
| `RESILIENT` | When set, a debate node whose LLM output fails *abstains* (contributes nothing) so the run still reaches a verdict, instead of aborting with a terminal `error`. Set it when recording local demo takes on the flaky local models; leave off for the honest fail-loud default. The budget breaker always stays loud | unset (off) |
| `ANTHROPIC_API_KEY` / `GROQ_API_KEY` | Provider keys, needed only for their backends | — |
| `FINNHUB_API_KEY` | When set, snapshot builds source historical date-ranged company news from Finnhub (window = `NEWS_DAYS`) instead of yfinance current-news. Optional — falls back to yfinance when unset. Free key at [finnhub.io](https://finnhub.io); put it in `backend/.env` (auto-loaded) | unset |
| `NEWS_DAYS` | Finnhub news lookback window (days before as-of) when building a snapshot | `30` |
| `NEWS_CAP` | Max news items kept per snapshot. Raising it enlarges the Sentiment + Red-Team prompts — mind the model's context window | `50` |
| `EVENT_DELAY_S` | Inter-event delay on the SSE stream (readability) | `0.25` |
| `SNAPSHOT_DIR` | Snapshot/whitelist location | `backend/data/snapshots` |
| `RUNS_DIR` | Recorded run logs (replay reads the latest per pair, or a specific one picked by model) | `backend/data/runs` |
| `SPEND_FILE` | Persistent global spend counter | `backend/data/spend.json` |
| `VITE_API_BASE` | Frontend → backend base URL (Path B). Ignored in static mode | `http://localhost:8000` |
| `VITE_STATIC` | Build-time flag: `1` builds the **replay-only static site** (Path A) — reads bundled JSON from `public/data/`, replays client-side, no backend/API/key | unset |
| `VITE_EVENT_DELAY_MS` | Static-mode client-side replay pacing | `250` |

**Cost guardrails are always on:** every run is capped at 15 LLM calls, prints
its estimated cost, and accumulates into the global counter. Each recorded run
also stores a `usage` block (per-run token breakdown + call count + est cost) in
its run log for cross-run comparison — token counts are real even on Ollama,
where cost is $0.

## Deploy the replay-only static site (Path A)

A `$0`, backend-free site that replays recorded runs from bundled JSON — no LLM,
no API key, nothing paid in the bundle. Live, on-demand runs (Path B) stay
possible later by pointing `VITE_API_BASE` at a hosted backend and leaving
`VITE_STATIC` unset; no code is removed.

1. **Record the runs you want to ship.** Do live runs (`LLM_BACKEND=ollama …`);
   each persists to `backend/data/runs/` tagged with its model. Curate by which
   files live there — delete takes you don't want public.
2. **Bundle them:** `cd frontend && bun run bundle`. Copies `data/runs/*.json`
   (+ each referenced outcome) into `frontend/public/data/` and writes
   `index.json` (the offline stand-in for `GET /whitelist` + `GET /runs`).
3. **Commit `frontend/public/data/`** — Vercel builds from git, so the bundled
   JSON must be committed (it is *not* gitignored).
4. **Deploy to Vercel:** set the project's **Root Directory → `frontend`**.
   `frontend/vercel.json` pins the rest (`VITE_STATIC=1 bun run build`,
   output `dist/`, `bun install`). Re-run steps 2–3 and push to ship more runs.

Preview the static build locally: `VITE_STATIC=1 bun run build && bun run preview`.
