# Alpha Swarms — Project Context

> Implementation plan for the Alpha Swarms hackathon project. (Domain glossary lives in CONTEXT.md.)
> Captures the problem, architecture, stack, and constraints.
> **Timeline: 1 week development. Demo delivered as a pre-recorded video.**

## Team
- **Name:** Swarm Traders
- **Size:** 2 people
- **Dev time:** ~1 week (compressed — see Build Order and Cuts)
- **API budget:** develop free on local models; reserve Claude credits for demo runs (see Cost section)
- **Demo format:** Pre-recorded video (live demos have failed before; recording removes on-stage failure risk and lets us capture our best run)

---

## Problem Statement
> Investment research is slow, inconsistent, and often prone to confirmation bias. Analysts tend to stick with a thesis, under-weight the bear case, and cannot cover a wide range of stocks. We aim to solve this with a swarm of specialist agents that research and debate each other, providing an evidence-cited verdict.

**Framing note:** Lead the pitch with *rigor and bias-correction*, not speed. The real win is **coverage at scale + bias resistance**. If a judge pushes on "slow," pivot to "fast across many stocks, rigorous on each." Do **not** overclaim alpha — sell *process quality*, not guaranteed returns ("a research analyst that never skips the bear case," not "a money printer").

---

## Core Concept
A multi-agent system where specialist research agents independently build investment theses, then a debate/synthesis layer forces adversarial challenge before converging on a conviction-scored recommendation with cited evidence.

---

## Use Case Scenario
**Anchor scenario (one sentence):**
> An analyst inputs a stock ticker, and a swarm of specialist AI agents independently research it, debate each other's conclusions, and deliver a single conviction-scored recommendation backed by cited evidence and the strongest opposing view.

**Concrete flow:** User types a ticker + an "as of" date → swarm returns a buy/sell/hold call with a conviction score, key evidence, and the strongest counterargument, with the debate streaming live as it happens.

**Demo scenarios to showcase (build core, demo through 2–3 hand-picked tickers):**
1. **Bear-case discipline** — analyst is already bullish; swarm surfaces the bear case they overlooked. *(Honest framing.)*
2. **Contested stock** — point at a polarizing name where smart people disagree; debate layer shines because dissent is real. *(Showpiece.)*
3. **Earnings post-mortem** — run "as of the day before earnings," then reveal what actually happened. *(Mic-drop, known-outcome reveal.)*

**Prep tip:** Pre-select demo tickers/dates with *interesting* historical setups and cache their data early. Boring stock = boring demo.

---

## Architecture

### How it fits together (mental model)
- **One Python web app (FastAPI) + one static site (React).** That's the whole system to host.
- **LangGraph is a library, NOT a service.** It runs *inside* the FastAPI process (`pip install langgraph`, `import` it). There is nothing separate to host/deploy/containerize for LangGraph. The agents and debate logic are just code living inside the FastAPI app.
- **Live debate works via SSE (Server-Sent Events)** — a one-way stream from backend → browser. The backend emits an event per agent step; the frontend renders each as it arrives.

```
Frontend (React)  <--GET /stream (SSE)--  Backend (FastAPI)   # one endpoint; ticker+as_of as query params
                                          | runs
                                          v
                                   LangGraph orchestrator (library, in-process)
                                   shared blackboard, emits event per node
                                     ├─ Fundamentals  ┐
                                     ├─ Sentiment     ├─ parallel theses (pre-sliced, no tools)
                                     └─ Technicals    ┘
                                          ↓
                                     Red-team (grounded/logical attacks, single call)
                                          ↓
                                     Rebuttals (may call tools over cached snapshot)
                                          ↓
                                     Judge (adjudicates attacks → per-specialist stances)
                                          ↓
                                     Aggregate stance (computed) → banded verdict OR No Call
                                          ↓
                                LLM provider: Ollama (dev) / Claude (demo)
                                Cached data: point-in-time snapshots (tools read these, never live)
```

### Agents (lean 1-week version)
| # | Agent | Role |
|---|-------|------|
| 1 | Orchestrator | Fan-out, drives the fixed two-turn debate flow, owns shared state (blackboard) |
| 2 | Fundamentals | Valuation, earnings, balance sheet health |
| 3 | Sentiment/News | News flow, analyst sentiment |
| 4 | Technicals | Price action, momentum, volume |
| + | Red-Team | Attacks each gated-in thesis (single call); every attack must be grounded counter-evidence or a logical flaw |
| + | Judge | Adjudicates which attacks landed, sets each specialist's Adjudicated Stance, assembles the evidence trail — does NOT author the headline number (it is computed) |

> Flow is a fixed two-turn debate (assert → attack → one rebuttal), NOT a convergence loop.
> ~8 calls/run base (3 theses + 1 Red-Team + 3 rebuttals + 1 Judge); ~10–12 with debate tool-calling.
> Macro agent and multi-round debate are CUT for the 1-week scope (mention as "what we'd scale to").
> Agents are *roles* = a prompt + tools + a loop, running as async LangGraph nodes in one process.

### How LangGraph works (implementation model)
1. **State object** (TypedDict/dict) = the blackboard: ticker, theses, attacks, rebuttals, adjudicated stances, evidence pool, current phase.
2. **Nodes** = Python functions: take state, call an LLM/tool, return a state update. Each agent is a node.
3. **Edges** = control flow. The debate is a **fixed linear sequence**, not a conditional loop: `specialists → red_team → rebuttals → judge`. No convergence/round-count branching (single round is scoped in).
4. **Compile + invoke.** Use `graph.stream(...)` streaming mode — it yields state after each node. Those yields become the SSE events. This is the feature that makes the live debate cheap to build.

```python
def fundamentals_node(state):
    # initial thesis: pre-sliced context, single call, NO tools (see ADR 0003)
    thesis = llm_complete(build_prompt(state))   # provider wrapper, see below
    return {"theses": state["theses"] + [thesis]}

def rebuttal_node(state):
    # debate turn: MAY call tools over the cached snapshot to defend (bounded 2–3 iters)
    revised = llm_complete_with_tools(build_rebuttal_prompt(state), tools=snapshot_tools)
    return {"rebuttals": state["rebuttals"] + [revised]}
```

### Live debate event design
Agents emit *structured events*, not just final values. Backend relays each to the SSE stream; frontend renders each event type into the right UI element.
```python
yield {"type": "agent_start", "agent": "fundamentals"}
# stance is a single signed number in [-1, +1]; sign = direction, magnitude = strength
yield {"type": "thesis", "agent": "fundamentals", "stance": 0.7, "evidence": [...]}   # each item grounded or dropped
yield {"type": "attack", "agent": "red_team", "target": "fundamentals",
       "kind": "evidence" , "critique": "margins compressing", "counter_evidence": [...]}  # kind: evidence | logical
yield {"type": "tool_call", "agent": "fundamentals", "tool": "get_financials", "args": {...}}   # debate-phase tool use
yield {"type": "tool_result", "agent": "fundamentals", "tool": "get_financials", "data": {...}}
yield {"type": "rebuttal", "agent": "fundamentals", "proposed_stance": 0.55}   # advocacy, not final
yield {"type": "adjudication", "agent": "fundamentals", "adjudicated_stance": 0.4, "attacks_landed": [...]}  # Judge sets this
# Verdict: computed aggregate, never authored by the Judge. May be a No Call.
yield {"type": "verdict", "aggregate_stance": -0.05, "direction": "neutral",
       "conviction": 0.05, "dissent": "high", "voting_lenses": 3}
# or: yield {"type": "verdict", "direction": "no_call", "reason": "quorum not met (<2 grounded lenses)"}
```
- **Granularity:** one event per *agent step* (start → thesis → attack → tool → rebuttal → adjudication → verdict). NOT token-by-token (harder, noisy).
- **Add a small delay between events** — makes the debate readable instead of a blur.

### Key design decisions
- **State = shared blackboard** agents read/write — NOT passing full context between agents. Keeps token cost down + clean audit trail.
- **Trim the blackboard** — pass *summarized* theses, not raw reasoning, to each agent. Prevents token blow-up across rounds (biggest hidden cost in multi-agent loops).
- **Fixed two-turn debate, no convergence loop** — assert → attack → one rebuttal, then Judge. (Multi-round + variance-based convergence are CUT; see Cuts.)
- **Scoring is a computed aggregate** — each specialist emits a signed **stance** in [−1,+1]; the headline is the equal-vote plain mean of gated-in specialists' *Judge-adjudicated* stances, banded (±0.25 neutral / ±0.75 strong, per Refinitiv convention). Direction, Conviction (=|aggregate|), and Dissent all derive from it, so they can't contradict on screen. See ADR 0001.
- **Evidence grounding (deterministic, two-tier, symmetric)** — numeric claims must value-match the snapshot; textual claims must resolve to a real cached source. A specialist needs ≥1 grounded item to earn a vote (a *gate*, not a weight); Red-Team attacks are held to the same bar. No grounding, no vote. Defense against fabricated reasoning.
- **Quorum or abstain** — <2 gated-in lenses ⇒ **No Call** (honest abstention), not a forced number. Always show N (voting lenses) beside conviction; report dissent as a Low/Med/High band.
- **Disagreement as a feature** — surface agent conflict, don't hide it.

---

## Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Orchestration | **LangGraph** (Python library) | Runs in-process inside FastAPI. Stateful graph maps onto the fixed two-turn debate sequence (no convergence loop). SSE events come from an explicit event queue, **not** `.stream()` (it can't see intra-node events) — see ADR 0004. Ignore the paid "LangGraph Platform" cloud product — not needed. |
| LLM (demo) | **Claude Sonnet 4.6** | Specialists + Judge all on Sonnet for this budget (no Opus). |
| LLM (dev) | **Local via Ollama** | Free. Qwen 2.5 7B/14B (best at structured JSON), Llama 3.3 8B, or Mistral 7B. Groq free tier as no-local-compute fallback. NOTE: Ollama runs on your machine only — a cloud-deployed backend can't reach it; that's fine, the deploy/demo path uses Claude. |
| Backend | **FastAPI** | Hosts the graph, single `GET /stream?ticker&as_of` (SSE) — starts the run and streams agent steps; whitelist miss returns `400` before streaming. Holds API key (never in frontend). |
| Frontend | **React + Vite + Tailwind** | Ticker+date input, three live per-agent lanes (SSE), conviction score + evidence cards. Fallback is a terminal pretty-printer of the same event stream (not Streamlit — that bypasses the SSE backend), then replay mode. |
| Data | **Curated point-in-time snapshots** | yfinance / Financial Modeling Prep / Alpha Vantage for fundamentals+prices; saved news headlines with stable IDs + publish dates. Every datum dated ≤ As-Of; the **Outcome is held OUT of agent-visible state**. Whitelisted (ticker, date) pairs. **Never live-call during a run.** See ADR 0002. |
| Agent tools | **Read the cached snapshot, never live** | Debate-phase tools (`get_financials`, `get_price_history`, `get_news`) enforce the As-Of filter internally (leakage impossible by construction). Initial theses use pre-sliced context; only rebuttals/Red-Team call tools, bounded 2–3 iters. See ADR 0003. |
| Containerization | **None (skip Docker)** | Run `uvicorn` + `bun run dev` directly. Add Docker ONLY if the 2-person team hits environment drift. Not a best-practice requirement for a 1-week local build. |
| JS tooling | **Bun** (over npm) | Preferred for the frontend: `bun install`, `bun run dev`, `bunx`. Fall back to npm only if a dep is Bun-incompatible or CI needs npm. |
| Python tooling | **uv** (over pip) | Preferred for all Python env/dependency work: `uv venv`, `uv pip install`, `uv add`. Faster installs + a lockfile. Use pip only where uv can't. |

### Critical: Provider Abstraction
> **Superseded by ADR 0005.** The abstraction is a LangChain chat model, not a
> hand-rolled `llm_complete()`. The one-flag / develop-on-Ollama-flip-to-Sonnet
> strategy below still holds; the mechanism changed because `.bind_tools()`
> normalizes the tool-calling loop across providers (the hand-rolled tool path was
> mis-priced at ~20 min). The `max_calls` breaker + cost logger move into a
> LangChain callback handler (ADR 0005), not the orchestrator.

One knob — the `LLM_BACKEND` env var — picks the backend. Each entry fully
specifies provider + model, so switching is a single value. Develop on Ollama at
home; use a cheap cloud backend when you can't run Ollama; flip to Sonnet near demo.

**Backends:**

| `LLM_BACKEND` | Model | Cost | Use for |
|---|---|---|---|
| `ollama` | Qwen 2.5 (local) | Free | Home dev — plumbing + flow |
| `groq` | Llama 3.3 70B (hosted) | **Free** | On-the-go plumbing tests (no local compute) |
| `haiku` | `claude-haiku-4-5` | ~$1/$5 per M | On-the-go **faithful** tests — same family as Sonnet, so it de-risks the demo switch and shares tool-calling + `cache_control` mechanics |
| `sonnet` | `claude-sonnet-5` | $3/$15 per M | Demo / final tuning (paid) |

> Different-family backends (`groq`, Gemini) test *plumbing*, not final reasoning
> quality or prompt tuning — those don't transfer cleanly across families (see
> Local Model Caveats). `haiku` is the honest cheap proxy for Sonnet.
> Any tool-using debate node (ADR 0003) needs a tool-calling-capable backend; all
> four above qualify. A backend that can't do tools only runs the pre-sliced path.

```python
import os
from langchain_ollama import ChatOllama
from langchain_anthropic import ChatAnthropic
from langchain_groq import ChatGroq

BACKENDS = {   # name -> factory; add a line to add a backend, agents unchanged
    "ollama": lambda: ChatOllama(model="qwen2.5"),
    "groq":   lambda: ChatGroq(model="llama-3.3-70b-versatile"),
    "haiku":  lambda: ChatAnthropic(model="claude-haiku-4-5"),
    "sonnet": lambda: ChatAnthropic(model="claude-sonnet-5"),
}
def get_chat_model():
    return BACKENDS[os.environ["LLM_BACKEND"]]()   # .bind_tools(...) / .with_structured_output(...) — ADR 0005
```

**Changing on the fly:** keep every provider key in `.env` (`ANTHROPIC_API_KEY`,
`GROQ_API_KEY`, …) once — then switching is just editing `LLM_BACKEND` and
restarting `uvicorn` (seconds), no code change. Two rules: **never switch mid-run**
(inconsistent reasoning + breaks prompt caching — pick per run), and if you add a
dev-only `?backend=` query param for no-restart local switching, **never expose it
on the hosted site** (a visitor could pick `sonnet` and drain the budget — keep
backend selection server-side / local only).

---

## Hosting

**For the demo: host nothing.** We're recording a video. Run everything local on the laptop, record the best run. Lowest risk, free, full environment control, no SSE-host compatibility worries.

**Local run (dev + recording):**
```
uv venv && source .venv/bin/activate
uv pip install langgraph fastapi uvicorn
uvicorn main:app --reload   # backend → localhost:8000
bun install && bun run dev  # frontend → localhost:5173
```

**Public viewing — static replay site (recommended if you want a shareable URL):**
Host a site where interested people watch the agents work on a whitelisted stock —
**without running the agents live.** It re-streams pre-recorded runs, so it costs
**$0 per view**, can't leak future data, and can't run up API cost. This is
the payoff of the event-queue design (ADR 0004): a recorded run *is* a JSON event
log, and replaying it is just draining that log through the same reducer/lanes.
- **No backend needed.** Swap the frontend's event source from `EventSource` to a
  bundled `events.json`; a small player emits events on the same inter-event delay.
  The per-agent-lane reducer is unchanged, so the whole UI "just works."
- **Deploy as a pure static site:** `bun run build` → drop `dist/` on Vercel /
  Netlify / GitHub Pages / Hugging Face Spaces. Free, permanent, no card, no SSE
  host, no API key exposed.
- **Artifacts:** run each of the 2–3 whitelisted stocks once on Sonnet locally and
  save the recorded events (`nvda.json`, …) — the same runs you record for the
  video, so ~$0 extra.
- **Complexity: low.** Marginal work over the frontend + replay mode you're already
  building ≈ a ~20–40-line "player" + a stock picker + one deploy — call it a half
  day, most of it first-time deploy fiddling, not code. Limitation: canned 2–3
  stories, no arbitrary tickers (already true live, per the whitelist / ADR 0002).

**If a *live* URL is also wanted (harder; stretch goal / backup, not required):**
- Only worth it with more credits (ask the organizers). Gate
  it hard: rate-limit + whitelist-only + the spend cap wired to the breaker (Q7).
- The critical requirement is **SSE support (long-lived streaming connections).**
- **Backend (FastAPI) — good fits:** Railway, Render (free tier sleeps when idle, fine for demo), Fly.io, Hugging Face Spaces (free, permanent, no card), or a $5/mo VPS (DigitalOcean/Hetzner/Linode — most control, most setup).
- **Backend — AVOID for SSE:** Vercel/Netlify functions, AWS Lambda, GCP Functions — serverless timeouts cut off streaming.
- **Frontend (React):** Vercel or Netlify (static site, trivial, free). Fine here — just don't put the FastAPI backend on serverless.
- **Tunnel option:** `ngrok http 8000` or Cloudflare Tunnel exposes the local backend at a public HTTPS URL with zero deploy.
- Easiest least-effort combo if deploying: **Railway/Render (backend) + Vercel (frontend).** Treat as stretch goal — the video is the deliverable.

---

## Cost Strategy

**Pricing (per M tokens):** Haiku 4.5 $1/$5 · Sonnet 4.6 $3/$15 · Opus 4.8 $5/$25. Output = 5× input. Caching cuts cached input ~90%. Batch API = 50% off (async).

**Per full run estimate:** ~$0.60–1.10 (Sonnet) — full paid runs add up fast, so do NOT develop on them.

**The plan:**
1. **Mock agents first** — fake agent returns hardcoded thesis JSON, free. Build the orchestration skeleton + SSE pipeline against mocks. Cuts real API usage ~80%. **Do this first.**
2. **Develop on local (Ollama)** — free, for all plumbing/flow debugging (graph fan-out, loop termination, blackboard updates, JSON parsing, SSE rendering).
3. **Test agents in isolation** — tune one agent's prompt with single calls, not full runs.
4. **Cache aggressively** — `cache_control` on data snapshots + system prompts from day one.
5. **Switch to Sonnet near the end** (NOT the final hour) — buffer to absorb surprises. Spend your credits here on reasoning-quality tuning + recording the demo runs.

**Estimated spend with discipline: $5–8.**

### Non-Negotiable Safeguards (build before any agent)
- **Hard circuit breaker** in orchestrator: `max_calls` per run (~15, to cover debate tool-calling iterations) + a per-agent tool-iteration cap (2–3), kill switch if exceeded. One runaway tool loop can eat a third of the budget.
- **Cost logging per run** — print estimated $ after every execution.
- **Global spend counter** — check daily; keep an eye on cumulative spend.

### Local Model Caveats
- Small models flakier at **clean JSON** — use Qwen, add defensive parsing.
- **Debate quality** (genuine red-team attacks, conviction updates) only really shows on Sonnet — don't judge the concept by local output.
- **Prompt sensitivity** — prompts tuned for Llama may need rework on Sonnet. The Ollama→Sonnet switch is its own task, not a flip. Budget paid time for re-tuning.

### Also
**Ask hackathon organizers for more credits.** Anthropic frequently grants $25–100+/team. Highest-ROI move before optimizing a token.

---

## One-Week Build Order

| Day | Focus |
|-----|-------|
| 1 | Provider abstraction + circuit breaker + cost logger FIRST. Data layer: cache 3 tickers. One specialist returning structured JSON on Ollama. |
| 2 | All 3 specialists running in parallel + blackboard. |
| 3 | Red-Team + rebuttal turn + Judge adjudication; grounding gate + quorum/No-Call. Full pipeline runs end-to-end on Ollama — **pre-sliced context, no tools yet** (this is the fallback baseline). |
| 4 | FastAPI wrapper + **SSE streaming** (the live-debate backbone — everything visual depends on it). Then layer the **debate tool-calling increment** (rebuttal/Red-Team call cached-snapshot tools, bounded 2–3 iters) on top of the working pipeline — if it eats time, ship the Day-3 pre-sliced baseline instead (ADR 0003). |
| 5 | React frontend: input → live agent stream → verdict cards. |
| 6 | **Switch to Sonnet.** Quality tuning, fix prompts, pick 2–3 demo tickers, **record demo video.** |
| 7 | Polish, re-record best run, buffer. |

**Build agent quality before UI.** A swarm that reasons well in a terminal beats a beautiful UI wrapping shallow output.

### Cuts vs. the original 2-week plan (to fit 1 week)
- **Backtest harness / eval scoring: CUT.** Was the credibility booster; replaced by 2–3 hand-picked demo scenarios with known good stories.
- **Macro agent: CUT** (3 specialists).
- **Multi-round debate: CUT** (single round).
- **Separate cloud hosting: not required** (recorded video; local run).

---

## Demo Insurance
- **Pre-recorded video is the deliverable** — removes live-failure risk, captures the best run.
- **Replay/fallback mode (~30 min, worth it):** a flag that replays a pre-recorded set of debate events (from a good Sonnet run) through the same SSE pipeline. Even if recording live, this lets you re-shoot a clean run cheaply and costs $0 in credits to replay.

---

## The Honest Hard Part
Can't prove alpha in a week — sample is tiny, and the backtest is cut. Frame the demo around **process quality** (rigorous, cited, adversarial reasoning), not predictive accuracy. Pitch: *"a research analyst that never skips the bear case."* Use the contested-stock and earnings-post-mortem scenarios to make the reasoning visibly good.

---

## Output Schema (final Verdict — computed, not authored by the Judge)
- **Aggregate stance**: signed number in [−1, +1] (equal-vote mean of gated-in specialists' adjudicated stances)
- **Direction**: Bull / Neutral / Bear — banded from aggregate stance (±0.25 neutral, ±0.75 = high-conviction flag), OR **No Call** if quorum (<2 grounded lenses) isn't met
- **Conviction** (0–1): |aggregate stance| — always displayed alongside **N (voting lenses)**, never alone
- **Dissent**: Low / Med / High band (spread of the voting stances)
- **Cited evidence trail**: every scoring claim → source (numeric value-match or textual source-existence); ungrounded claims are dropped
- **Explicit risks + "what would change our mind"** (the landed attacks the Judge weighed)

> Per-specialist detail the UI also shows: initial stance → proposed rebuttal stance → Judge-adjudicated stance, plus which attacks landed. The Outcome (what actually happened) is revealed separately, never part of this schema.
