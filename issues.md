# Alpha Swarms — Implementation Issues

Breakdown of the 1-week build into independently-grabbable, tracer-bullet vertical
slices. Each slice cuts end-to-end through every layer it touches and is demoable
or verifiable on its own. Sources: `PLAN.md` (build order, budget), `ARCHITECTURE.md`
(system design), `CONTEXT.md` (domain language), `docs/adr/0001–0005`.

- **AFK** = can be implemented and merged without human interaction.
- **HITL** = requires a human decision, curation, or review.

Dependency graph (phases are groupings, not gates — a slice starts when its
blockers finish):

```
Phase 0          Phase 1                Phase 2      Phase 3           Phase 4
#1 ──┬── #2 ──┐
     │        ├── #4 ── #5 ── #6 ──┬───────────────── #8 (droppable)
     └── #3 ──┘                    │                  #9 ──┐
#1 ─────────────────────────────── #7 ──┬── #8            ├── #10 ── #11
                                        └── #9 ───────────┘
```

---

## Phase 0 — Foundations (Day 1)

### #1 · Walking skeleton: mock swarm streams SSE events end-to-end
**Type:** AFK · **Blocked by:** None — can start immediately

#### What to build
The full backend spine with zero LLM calls: a FastAPI app exposing
`GET /stream?ticker&as_of` (SSE via `sse-starlette`), a LangGraph graph wired as
the fixed two-turn debate sequence (`specialists → red_team → rebuttals → judge →
aggregate`), and the per-run `asyncio.Queue` event channel (ADR 0004). Every node
is a mock that emits hardcoded typed events (`agent_start`, `thesis`, `attack`,
`rebuttal`, `adjudication`, `verdict`) with the small inter-event delay. A
terminal pretty-printer consumes the SSE stream and renders the fake debate.
This is the free skeleton PLAN's budget strategy demands before any real agent.

#### Acceptance criteria
- [x] `uvicorn` serves `GET /stream?ticker&as_of`; connecting yields the full
      seven-type event sequence in contract order (ARCHITECTURE §3) and closes cleanly
- [x] Graph topology is the fixed linear sequence with parallel specialist fan-out
      and fan-in — no convergence loop
- [x] Events flow through an explicit per-run queue drained by the endpoint, not
      LangGraph `.stream()` (ADR 0004); a run that raises mid-graph surfaces as a
      terminal `error` event instead of a dead socket
- [x] Terminal pretty-printer renders the mock debate readably
- [x] Zero LLM calls, zero API spend

---

### #2 · Provider abstraction + circuit breaker + cost logger
**Type:** AFK · **Blocked by:** #1

#### What to build
The `LLM_BACKEND` env flag selecting a LangChain chat model (`ollama` / `groq` /
`haiku` / `sonnet`, ADR 0005), plus the non-negotiable safeguards PLAN requires
before any agent: a single global `BaseCallbackHandler` whose `on_llm_start`
counts calls and raises `BreakerTripped` past `max_calls ≈ 15` per run, and whose
`on_llm_end` accumulates estimated cost (including Anthropic
`cache_read`/`cache_creation` counts) and prints per-run `$`. Wire `cache_control`
support for Anthropic backends (system prompts + snapshot slices) from day one.
Verify end-to-end with one trivial real call on the free Ollama backend, and show
a tripped breaker arriving as the terminal `error` SSE event.

#### Acceptance criteria
- [x] Switching backends is editing `LLM_BACKEND` and restarting — no code change;
      unknown backend fails fast at startup
- [x] Breaker trips at the cap in a test and cannot be bypassed by node code
      (handler is attached globally, not per-node)
- [x] A tripped breaker mid-run reaches the SSE client as a terminal `error` event
- [x] Every run prints estimated $ on completion; a persistent global spend counter
      accumulates across runs
- [x] One real completion round-trips on `ollama` (or `groq` fallback)

---

### #3 · Point-in-time Snapshot layer + whitelist enforcement
**Type:** AFK · **Blocked by:** #1

#### What to build
The offline ingestion path and the Snapshot data model (ADR 0002): a script that
builds a curated JSON bundle per `(ticker, as_of)` — prices, last *reported*
fundamentals (checked by filing date, not period), news headlines with stable
`source_id` + publish dates — with every datum stamped with an availability date
and hard-filtered to ≤ As-Of. The Outcome is stored in a separate object that
never enters agent-visible state. `GET /stream` refuses a non-whitelisted
`(ticker, as_of)` with `400` before streaming. Build against one placeholder
ticker; final demo curation is #10.

#### Acceptance criteria
- [x] Ingestion script produces a Snapshot for one `(ticker, as_of)` pair from
      yfinance/FMP/Alpha Vantage, run offline — never during a run
- [x] An automated check proves no datum in the Snapshot is dated after the As-Of
      Date; fundamentals are the last reported before it
- [x] Outcome lives in a separate file/object, absent from everything the graph loads
- [x] Non-whitelisted ticker or date → `400`, no LLM call, no live fetch

---

## Phase 1 — The reasoning pipeline on Ollama (Days 2–3)

### #4 · First real specialist: Fundamentals thesis end-to-end
**Type:** AFK · **Blocked by:** #2, #3

#### What to build
Replace the mock Fundamentals node with the real thing: Pydantic models for
Thesis / Stance / Evidence (numeric tier `{claim, citation_key, cited_value}`,
textual tier `{claim, source_id, quoted_span}`), a pre-sliced Snapshot context
(no tools, single call — ADR 0003), and `.with_structured_output(Thesis)` with
one validation-retry on the local backend (ADR 0005). The `thesis` SSE event now
carries a real stance in [−1, +1] and a real evidence list, rendered by the
pretty-printer.

#### Acceptance criteria
- [x] A run on `ollama` streams a real Fundamentals `thesis` event with a signed
      stance and structured evidence citing Snapshot keys
- [x] Malformed model output triggers exactly one validation-retry, then fails
      gracefully (terminal `error` event), never a crash
- [x] The node reads only the pre-sliced Snapshot context — no tool calls, one
      LLM call, breaker count confirms it

---

### #5 · Three specialists in parallel + deterministic grounding gate
**Type:** AFK · **Blocked by:** #4

#### What to build
Add Sentiment/News and Technicals nodes, fan out all three in parallel with the
blackboard merged by reducers, and implement the grounding validator as a typed,
deterministic function (ADR 0001): numeric claims must resolve their
`citation_key` in the Snapshot *and* value-match within tolerance; textual claims
must resolve `source_id` to a real cached source (exact-substring `quoted_span`
earns the Verified Quote badge — a badge, not a gate). Ungrounded evidence is
dropped before scoring; a specialist needs ≥1 Grounded Evidence item to earn a
vote. Gate results are visible in the stream.

#### Acceptance criteria
- [x] One run streams three `thesis` events from parallel nodes; interleaved
      arrival merges cleanly into the blackboard
- [x] Unit tests: fabricated `citation_key`, out-of-tolerance `cited_value`, and
      unresolvable `source_id` are each dropped; valid items pass; exact
      `quoted_span` sets the badge
- [x] A specialist with zero grounded items is excluded from voting and the
      stream shows it
- [x] Blackboard passes summarized theses between nodes, not raw reasoning

---

### #6 · Full debate + computed Verdict (pre-sliced baseline)
**Type:** AFK · **Blocked by:** #5

#### What to build
The rest of the debate, still pre-sliced (no tools — this is the ADR 0003
fallback baseline that must ship regardless): a single-call Red-Team node
attacking every gated-in thesis (each Attack `evidence`-kind with grounded
counter-evidence held to the same bar, or `logical`-kind), one Rebuttal turn per
specialist emitting a *proposed* stance, a Judge node that rules which attacks
landed and sets each Adjudicated Stance (ADR 0001 — it never authors the headline
number), and the pure-Python `aggregate` node: plain mean of gated-in adjudicated
stances → Direction bands (±0.25 / ±0.75), Conviction = |aggregate|, Dissent band,
N — or **No Call** when fewer than 2 lenses cleared the gate.

#### Acceptance criteria
- [x] A full run on `ollama` streams the complete sequence through `verdict`
      (~8 LLM calls; breaker confirms)
- [x] Red-Team attacks fail the same grounding gate when ungrounded; the Judge
      counts an attack as landed only if grounded counter-evidence or a valid
      logical flaw
- [x] `aggregate` is deterministic pure Python with unit tests for bands, the
      high-conviction flag, dissent bands, and quorum → No Call
- [x] Verdict event always carries N (voting lenses) beside conviction; No Call
      carries a reason
- [x] Per-specialist trail visible in the stream: initial stance → proposed
      rebuttal stance → adjudicated stance

---

## Phase 2 — The face (Days 4–5)

### #7 · React frontend: live agent lanes + Verdict card + Outcome reveal
**Type:** AFK · **Blocked by:** #1 (real content improves with #6, but the mock
skeleton is enough to build against)

#### What to build
The React + Vite + TypeScript + Tailwind static site: ticker + As-Of input,
native `EventSource` against `/stream`, a `useReducer` over the event union keyed
by agent producing three live per-agent lanes plus a verdict column. Renders every
event type: theses with evidence cards (Verified Quote badge), attacks, rebuttals,
adjudications with the stance trail, the Verdict card (direction, conviction + N,
dissent band, evidence trail, landed attacks / "what would change our mind") and
the No Call card. The Outcome is fetched separately and revealed only after the
verdict — never part of the stream. A terminal `error` event degrades the UI
gracefully. Use Bun for install/dev/build.

#### Acceptance criteria
- [x] `bun run dev` against a running backend renders a full debate live, events
      appearing per agent lane as they arrive
- [x] TypeScript event union mirrors the SSE contract; unknown events don't crash
      the reducer
- [x] Verdict card never shows Conviction without N and Dissent; No Call renders
      as honest abstention, not an error
- [x] Outcome reveal is a post-verdict interaction, absent from the DOM until then
- [x] Non-whitelisted input shows the `400` refusal cleanly

---

## Phase 3 — The agentic increment + demo insurance (Day 4–5, parallel)

### #8 · Debate-phase tool-calling over the cached Snapshot
**Type:** AFK · **Blocked by:** #6, #7 · **Droppable:** if this slips, ship the
#6 pre-sliced baseline (explicit ADR 0003 fallback)

#### What to build
The headline agentic feature: `get_financials`, `get_price_history`, `get_news`
tools that read only the cached Snapshot with the As-Of filter enforced *inside*
the tool (leakage impossible by construction). Bind them to the Rebuttal and
Red-Team nodes only via `.bind_tools()` (initial theses stay pre-sliced), loop
bounded to 2–3 iterations per agent, with a terminal `submit_rebuttal` /
`submit_attack` tool whose argument schema is the Pydantic model as the exit
(ADR 0005 — structured-output coercion would collide with real tools). Emit
`tool_call` / `tool_result` events mid-node; render them in the frontend lanes as
the "challenged agent digs up evidence to defend itself" visual.

#### Acceptance criteria
- [x] A tool given `as_of` cannot return any datum dated after it — property
      verified by test, not prompt
- [x] Rebuttal/Red-Team runs show `tool_call`/`tool_result` events live in the UI
      between `attack` and `rebuttal`
- [x] Tool loop hard-stops at the iteration cap; full run stays under the ~15-call
      breaker (~10–12 calls)
- [x] Node exits when the model calls `submit_*`; the payload validates against
      the Pydantic schema with one retry
- [x] Disabling the increment (flag) reproduces the #6 baseline unchanged

> **Local-model caveat:** the mechanism is verified end-to-end (tools fire, events
> stream, breaker/cost hold, graceful degradation). On the free `ollama` backend
> the read tools fetch reliably but qwen doesn't consistently emit the nested
> `submit_*` exit call, so a full tool-mode run may terminate in a graceful `error`
> event — the documented ADR 0005 model-reliability limitation. Tool-mode is
> therefore off by default (`DEBATE_TOOLS=1` opts in) and is tuned for the capable
> demo backends in #10; the default free-backend path is the unchanged #6 baseline.
>
> **Recording local demo takes:** set `RESILIENT=1` so a node whose LLM output
> fails *abstains* (contributes nothing) and the run still reaches a verdict,
> instead of aborting with a terminal `error` — this maximizes the number of
> completed, replayable takes on the flaky local models. Off by default (honest
> fail-loud contract); the budget breaker always stays loud. Separately,
> `LLM_BACKEND` is now validated at startup, so a forgotten backend refuses to
> start rather than wasting a run on a mid-graph `RuntimeError`.

---

### #9 · Record + replay mode
**Type:** AFK · **Blocked by:** #6, #7

#### What to build
The demo insurance PLAN prices at ~30 min: recording a run persists the event
queue's output as a JSON event log; a replay flag re-streams a recorded log
through the same `/stream` SSE pipeline with the graph bypassed (ADR 0004 — a
recorded run *is* the log), preserving inter-event delays. The frontend works
unchanged. This is also the artifact the static replay site (#11) consumes.

> **Pitch decision (2026-07-05, `docs/pitch.md`):** the #11 static-site player
> additionally needs **presenter-paced act breaks** — auto-pause at each phase
> boundary (theses → attacks → tools → rebuttals → adjudication → verdict →
> Outcome), advance on keypress. Client-side player increment only; the
> auto-paced audience mode stays.

#### Acceptance criteria
- [x] Every run writes its full event log to a JSON file
- [x] Replay mode streams a recorded log through `/stream`; the frontend renders
      it identically to the live run
- [x] Replay makes zero LLM calls and costs $0 (breaker/cost log confirm)

---

## Phase 4 — Quality, demo, delivery (Days 6–7)

### #10 · Sonnet switch, prompt tuning + demo Snapshot curation
**Type:** HITL · **Blocked by:** #6, #7, #9 (#8 strongly desired)

#### What to build
The paid-quality pass. Human decisions throughout: pick the 2–3 demo
`(ticker, as_of)` pairs matching the three demo scenarios (bear-case discipline,
contested stock, earnings post-mortem), build and *eyeball each Snapshot for
future-data leakage* (~30 min each, ADR 0002 — correctness rests on this), flip
`LLM_BACKEND` to `sonnet` (via `haiku` as the faithful cheap proxy), and re-tune
prompts — PLAN is explicit that the Ollama→Sonnet switch is its own task, not a
flip, and ADR 0001 makes the Judge prompt the highest-leverage tuning target.
Confirm exact model pricing before paid runs; watch the global spend counter.

> **Pitch decisions (2026-07-05, `docs/pitch.md`):** the demo spine is the
> earnings post-mortem on a **historical** earnings event picked for story
> quality (not the latest print — point-in-time integrity makes them
> indistinguishable to the swarm). Outcome files currently store only
> `prices_after`; **enrich the demo pairs' Outcome JSON with the actual print**
> (reported vs. expected figures, next-day/5-day move) and render it on the
> reveal card — the Outcome is a bounded catalyst-reaction window (CONTEXT.md).
> Also record one deliberately *unflattering* run (No Call or
> wrong-but-well-reasoned) for the live site as Q&A armor.
>
> **Hard curation criterion:** every demo pair's as-of date *and* Outcome
> window must fall **after the demo model's training cutoff** (verify the
> exact cutoff via the `claude-api` reference before picking pairs) —
> otherwise "the model remembered the outcome from training" un-does the
> mic-drop. The snapshot controls the context; only the cutoff controls the
> weights.

#### Acceptance criteria
- [ ] 2–3 whitelisted demo Snapshots curated, each human-checked for leakage,
      each with a genuinely interesting story and a held-out Outcome
- [ ] Full runs on `sonnet` produce grounded theses, attacks that genuinely land,
      and a coherent Judge adjudication on all demo tickers
- [ ] Judge prompt tuned first; per-specialist stance trail reads credibly
- [ ] Total spend tracked; well inside the $15 wall with buffer for recording
- [ ] Each demo ticker's best run recorded as a replay event log (feeds #11)

---

### #11 · Demo video + static replay site
**Type:** HITL · **Blocked by:** #10

#### What to build
The deliverable. Record the demo video from the best runs (live or replayed —
replay lets you re-shoot a clean take at $0), narrated around *process quality*:
rigor, citations, the bear case never skipped — not predicted returns. Optionally
ship the shareable URL as the **static replay site**: swap `EventSource` for a
bundled `events.json` player over the same reducer/lanes, `bun run build`, deploy
`dist/` to Vercel/Netlify/Pages. No backend, no key, $0/view. A live public URL
stays a stretch goal, gated behind extra credits.

#### Acceptance criteria
- [ ] Pre-recorded video captures a full debate → Verdict → Outcome reveal for
      the chosen scenarios, framed on process quality
- [ ] (Optional) Static replay site deployed: stock picker over the 2–3 recorded
      runs, plays through the unchanged reducer/lanes, zero external calls
- [ ] Nothing in the shipped bundle exposes an API key or a paid endpoint

---

### #12 · Frontend UI refresh / design pass
**Type:** HITL · **Blocked by:** #7 · Should land before or alongside #11 — the
demo video captures whatever the UI looks like at record time

#### What to build
A visual polish pass on the existing React frontend, not a rebuild: the App
shell, per-agent lanes, tool-activity strip, and Verdict panel all render
correctly today but the terminal-courtroom v1 (IBM Plex Mono + Instrument
Serif, dark surfaces) is functional rather than sharp. User feedback after
Phase 2 was that it "looks kinda sick" but wants a design improvement pass
before the demo video ships. This is styling/layout/motion work over the
current event union — no new event types, no reducer changes, no backend
touch. The first step is to ask the user what specifically felt lacking
(spacing, hierarchy, motion, typography, something else) rather than guessing
a direction; re-invoke the `frontend-design` skill once that's known. Two hard
constraints carry over unchanged from v1: the CVD-validated agent color
palette (`--color-fundamentals/sentiment/technicals/redteam/judge` in
`index.css`) stays as-is, and Conviction is never displayed without N and
Dissent alongside it.

#### Acceptance criteria
- [ ] User feedback on what felt lacking is gathered and confirmed *before*
      any redesign work starts — not assumed
- [ ] `bun test` and `tsc -b` stay green throughout
- [ ] The SSE event contract and the `useReducer` event-union logic are
      untouched — this is a rendering/styling change only
- [ ] The CVD-validated agent palette tokens are unchanged; polarity colors
      stay paired with a label/icon, never shown alone
- [ ] Verdict card still never shows Conviction without N and Dissent; No Call
      still renders as honest abstention
- [ ] `bun run dev` against a running backend (live or replay) renders a full
      debate with the refreshed look, no regressions in existing lanes/cards
