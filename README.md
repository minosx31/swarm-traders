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

---

## How it works: an architectural overview

This section explains the whole system in plain language — what data goes in,
how the AI agents are organized, why they're organized that way, and how to read
what comes out. If you only read one section, read this one.

### The one-sentence version

You hand the system a stock and a date ("Was Palantir a buy as of June 1st?").
A team of specialist AI agents each research it independently, argue with each
other, an AI judge referees the argument, and the system does the final math to
produce a scored verdict — or an honest **"No Call"** when the evidence isn't
there. Nothing about that verdict is invented by an AI: it is *calculated* from
positions that each had to survive being fact-checked and attacked.

### 1. Where the data comes from

Before a single agent runs, the system assembles a **Snapshot**: a frozen
package of everything known about the stock *as of the chosen date*, and nothing
that came after. The agents only ever see this Snapshot — they never call a live
market feed. That is the core integrity guarantee: the system cannot accidentally
"cheat" by peeking at information from the future.

Four kinds of data go into (or alongside) a Snapshot:

- **Prices** — one year of daily trading history from Yahoo Finance.
- **Fundamentals** — the company's most recent *reported* quarterly income
  statement and balance sheet from Yahoo Finance. Crucially, a quarter that had
  *ended* but hadn't been *filed* yet is excluded, because in real life nobody
  would have had those numbers on the chosen date.
- **News** — up to 30 days of company news headlines from Finnhub (with Yahoo
  Finance as a fallback), all published on or before the chosen date.
- **Outcome** — what the stock actually did in the 30 days *after* the chosen
  date. This is deliberately kept in a separate file that nothing in the agent
  pipeline is allowed to read; the interface only reveals it *after* the verdict,
  so you can grade the swarm honestly.

A validator refuses to save a Snapshot if any datum is dated after the chosen
date, so a leak is impossible by construction rather than by good intentions.
(Free data sources are a scope choice, not a design limit — swapping in a
professional feed is a single fetcher function, because the Snapshot is the
abstraction everything else is built on.) The precise point-in-time rules are in
the table below.

**No snapshot, no run — this is enforced, not merely intended.** When you convene
a stock-and-date pair, the backend first checks whether that Snapshot already
exists on disk. If it does, it's reused exactly as-is (never re-fetched, so a
given date always tells the same story on every run). If it doesn't, the system
builds it — fetch, leak-check, save — *before* the debate is allowed to start.
And the endpoint that actually runs the agents flatly **refuses** any pair with no
saved Snapshot: it returns an error rather than quietly falling back to a live
fetch. So there is no path through the system in which an agent runs without a
frozen, leak-checked Snapshot already sitting in front of it.

### 2. How the agents are orchestrated — and why

The agents run through a **fixed pipeline** (not a free-for-all chat). Picture an
assembly line with two moments of parallel work:

```
        ┌─ Fundamentals ─┐                    ┌─ rebuttal ─┐
START ──┼─ Sentiment    ─┼─ Red-Team attacks ─┼─ rebuttal ─┼─ Judge ─ (compute) ─ Verdict
        └─ Technicals   ─┘                    └─ rebuttal ─┘
```

1. **Three specialists research in parallel, in isolation.** A Fundamentals
   analyst, a Sentiment analyst, and a Technicals analyst each write a thesis and
   a stance at the same time — *without seeing each other's work*. This isolation
   is deliberate: it stops the agents from anchoring on each other and
   manufacturing false consensus (the classic failure of a group chat where
   everyone agrees with whoever spoke first).
2. **A Red-Team attacks every surviving thesis** with the strongest counter-case
   it can find — the "never skip the bear case" step.
3. **Each attacked specialist gets exactly one rebuttal** to concede what landed
   and defend what didn't. These, too, run in parallel.
4. **A Judge referees** — it rules which attacks genuinely landed and sets each
   specialist's *final* stance. The Judge is explicitly a neutral referee with no
   opinion of its own on the stock.
5. **The system computes the verdict** with plain arithmetic. No AI writes the
   headline number.

The deep reason for this shape is a separation of powers we call the
**advocacy/adjudication split**: the agents that *argue* are never the ones that
*decide the score*. An AI is good at building a case and good at critiquing one,
but you don't want the same model that just argued a position to also grade
itself — that's how confirmation bias creeps back in. So arguing, judging, and
final scoring are three separate stages, and the last one isn't an AI at all.

### 3. How each agent knows its role

Each agent's "job description" is delivered two ways every time it runs:

- **A written brief** (its system prompt). The Fundamentals agent is told it
  analyzes valuation and earnings and must cite exact numbers; the Sentiment
  agent is told it reads news narrative and must quote real headlines; the
  Red-Team is told to attack; the Judge is told to referee neutrally and *not* to
  compute an overall verdict. The role isn't something the agent decides — it's
  assigned.
- **A tailored slice of data.** The Fundamentals agent is only handed the
  financial line items; Technicals only gets price-derived metrics; Sentiment
  only gets the news. An agent literally cannot cite data outside its lane
  because it was never shown it.

On top of the brief, every agent must answer in a **strict form** (a schema): a
thesis *must* include a stance number between −1 and +1 and a list of cited
evidence. It can't just write an essay.

**What "grounding" means.** To *ground* a claim is to trace it back to the
Snapshot and confirm it's actually there — think of it as **fact-checking with
receipts**. A claim isn't trusted because an articulate AI asserted it; it's
trusted only if it can be tied to an exact number or a real headline in the data
everyone agreed to work from. (We keep the word "grounding" because it's the
standard term in AI for anchoring a model's output to real source data instead of
letting it free-associate — but "sourced" or "fact-checked against the data" mean
the same thing here.)

**The grounding gate — the mechanism that makes this more than roleplay.** Every
piece of evidence an agent cites is put through this fact-check by a deterministic
(non-AI) validator:

- A numeric claim must reference a real data key *and* the number must match the
  Snapshot within 1%. Cite a figure that isn't there, or fudge it, and the claim
  is silently dropped.
- A news claim must reference a real headline; an exact verbatim quote earns a
  "Verified Quote" badge.

If an agent's claims all fail this check, **it loses its vote entirely**. This is
why the guarantees are "structural, not prompted": you're not *asking* the model
nicely not to hallucinate — a hallucinated citation is mechanically deleted and
costs the agent its seat at the table. The Red-Team is held to the exact same
bar, so it can't win with vague fear-mongering; an attack only counts if it's
backed by grounded counter-evidence or points to a genuine logical flaw.

### 4. Why the model you choose changes the quality

The same pipeline runs on anything from a free local model (Ollama running
`qwen2.5`) to Groq's Llama-70B to Claude Haiku or Sonnet. The choice of model is
a knob for **quality and depth**, not for integrity — and that distinction
matters:

- **Bigger, more capable models** (e.g. Claude Sonnet) write sharper theses,
  find more incisive attacks, follow the citation rules more reliably, and can
  drive the optional "fetch your own evidence" tool mode. You get a richer, more
  convincing debate.
- **Small local models** are free and private but weaker at following
  instructions precisely and at producing clean structured output. The system
  compensates with format enforcement and a one-shot "you got it wrong, try
  again" retry, but a weaker model will ground fewer claims and argue less
  crisply.

Here's the key point for a non-technical reader: because the verdict is
*computed* and the fact-checking is *deterministic*, a weaker model **cannot fake
confidence**. Its worst-case failure is to ground too little evidence — which
simply produces a more cautious result or an honest **No Call**, never a
confident-but-wrong number. So swapping models trades off *how insightful and
complete* the debate is, while the *honesty* of the output is guaranteed by the
machinery regardless of model.

### 5. How to read the final verdict

The verdict is a small set of numbers, each a different view of one underlying
figure — the **average of the surviving specialists' final stances** (one lens,
one equal vote):

- **Direction** — Bull, Bear, or Neutral. Anything close to zero (within ±0.25)
  is Neutral, matching the industry "Hold" convention.
- **Conviction** — how far from zero the average is. A conviction above 0.75 is
  flagged as high.
- **Dissent** — how much the specialists *disagreed* (the spread between the most
  bullish and most bearish surviving lens), reported as low / medium / high.
- **No Call** — if fewer than two specialists cleared the grounding gate, the
  system refuses to render a verdict at all. It would rather say "not enough
  solid evidence" than fake a number.

**How to actually use it:** treat this as a stress-tested second opinion, not a
trade signal. Never read conviction alone — read it *with* dissent and *with* the
list of attacks that landed and the strongest opposing view. A high-conviction
Bull with high dissent is telling you something very different from a
high-conviction Bull with low dissent. The product is built for a professional
analyst to *challenge their own thesis*: you bring the idea, the swarm brings the
bear case you'd rather not think about. It augments judgment; it does not replace
it.

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
