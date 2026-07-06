# Alpha Swarms — Pitch Strategy

> Decisions from the pitch re-alignment session (2026-07-05). Format: 8-min
> presentation + 7-min Q&A. Supersedes PLAN.md's "pre-recorded video is the
> deliverable" framing — the video insurance still exists, but the deliverable
> is a live-presented pitch with a demo.

## Format (decided)

- **8 minutes = slides + demo, presented live.** Demo runs off the static
  replay site (issue #11) — a live URL the audience can also visit on their
  own devices during/after the talk.
- **Presenter-paced, not stream-paced.** The replay player gets **act breaks**:
  auto-pause at each phase boundary (theses → attacks → tool digging →
  rebuttals → adjudication → verdict → Outcome reveal), advance on presenter's
  key. The demo becomes "slides that happen to be alive" — narrate each act as
  long as needed, resume when ready. Audience mode (public URL) stays
  auto-paced.
- **Narrate ONE agent's story arc, not the system.** E.g. "Fundamentals opens
  +0.7 citing three numbers → Red-Team attacks the margin claim → watch it dig
  through the snapshot to defend itself → it concedes, revises to +0.4 → the
  Judge rules the attack landed." One legible arc demonstrates the full flow
  without explaining the architecture. The other lanes are visible ambience
  proving it's a swarm.
- **Own the 30 seconds.** A full run takes ~30s — say it out loud as the
  coverage-at-scale point, don't hide it.

## Target persona (decided)

**The professional research analyst — concretely, our own in-house research
desk** (internal-hackathon recast of the original "analyst at a small/mid
fund"; see the journey section). Augmentation, not replacement.

- **Their pain:** covers 15–30 names, deeply covers ~5, structurally biased on
  all of them — a published thesis anchors its author. Nobody staffs a
  dedicated devil's advocate per stock; adversarial review is expensive and
  socially awkward.
- **What we sell:** a tireless, un-embarrassable adversarial review for every
  name on the coverage list. The analyst still makes the call — but makes it
  having seen the strongest opposing case, with every claim cited.
- **Retail** is a one-line "and eventually…" expansion, never the pitch.

### Language rule: "stress-test", never "support"

The analyst brings a thesis; the swarm **attacks** it. They walk away with a
*survived* thesis (stronger, now citing the bear case they'd skipped) or a
revised one. Agreement is the **output** of the process, never the input.
Saying analysts use it to "support their thesis" pitches
confirmation-bias-as-a-service — the disease the product cures.

## Differentiation — "Isn't this just ChatGPT with extra steps?"

The differentiators are **structural guarantees, not prompts**:

1. **Independence by construction** — three specialists build theses in
   parallel with no shared context. One model asked for "both sides" anchors
   on its first idea; genuinely independent priors don't.
2. **Adversarial review with a grounding gate** — Red-Team attacks are
   *checked* (grounded counter-evidence value-matched against the snapshot, or
   a valid logical flaw) or the Judge discards them. Self-critique in a single
   prompt is vibes; this is gated.
3. **Fabrication is dropped deterministically** — numeric claims must
   value-match the point-in-time snapshot; quotes must resolve to a real
   cached source. A hallucinated citation costs the specialist its **vote**.
4. **The verdict is computed, never authored** — headline = arithmetic mean of
   Judge-adjudicated stances; Direction/Conviction/Dissent all derive from one
   quantity, so they cannot contradict. You can't sweet-talk the verdict.
5. **Honest abstention** — quorum fails ⇒ **No Call** ("insufficient grounded
   evidence"). A tool that can decline to answer is a different category from
   one that always answers.

**Slide one-liner:** *"You can't prompt away confirmation bias — you have to
structure it away."*

vs. **traditional research**: coverage at scale (~30s/name), no ego, no
anchoring, the bear case never skipped, cited audit trail, honest abstention.

## Demo spine (decided)

- **The narrated arc = earnings post-mortem** on a **historical** earnings
  event picked for story quality — not the latest print. Point-in-time
  integrity makes them indistinguishable to the swarm, and a past event has a
  *closed* Outcome window (no demo-day drift problem). Pitch line: *"we can
  replay any day in market history and grade the swarm against what actually
  happened."*
- **Point-in-time integrity is delivered by the demo, not the slide.** It
  stays out of the differentiator list; the reveal moment carries it: *"that
  was the swarm's call knowing only what was knowable that day — enforced in
  code, not prompts. Here's what actually happened."* → Outcome reveal.
- **Outcome = bounded catalyst-reaction window** (CONTEXT.md): the reported
  print vs. expectations + next-day/5-day move. The 30-day price tail is chart
  context only. If asked "but the price today is different": every analyst
  call has a horizon; drift beyond it is confounded by everything since.
- **Bear-case discipline is the arc's narration**, not a separate scenario
  ("watch the bear case get forced into the record").
- **Contested stock / No Call = the 30-second honesty beat** if time allows;
  otherwise lives on the site + in the Q&A back pocket.
- **Publish one deliberately unflattering run** (No Call or
  wrong-but-well-reasoned) on the live site. Cherry-pick question gets:
  "Of course — it's a demo of process, and n=1 proves nothing about returns
  either way; that's why we sell process quality, not alpha. Here's a run
  where it said No Call."

## Run-of-show (decided)

| Time | Beat | Content |
|---|---|---|
| 0:00–0:45 | Cold open: the pain | In *our own* researcher's shoes: covers many names our clients hold, deeply knows a few, anchored on every published thesis; nobody staffs a devil's advocate per stock — and our clients only ever see the bull case. No "we built a multi-agent system." |
| 0:45–1:30 | What it is | One sentence + the debate as acts (theses → attack → rebuttal → judge → verdict). One-liner: "you can't prompt away confirmation bias — you have to structure it away." No architecture diagram. |
| 1:30–5:30 | The demo (~4 min) | Presenter-paced acts, one narrated arc, historical earnings pair. Frame it as the client surface: "what you're watching is what a client would see on the stock page." Ends on the Outcome reveal (mic-drop at ~5:30). |
| 5:30–6:30 | "Why isn't this ChatGPT?" | Pre-empted on stage, said as the slide title. All 5 guarantees on the slide; speak independence, grounding gate, computed verdict. |
| 6:30–7:15 | Honesty + scale | No Call / high-Dissent beat; ~30s a name, any day in history replayable → grading the process at scale is the roadmap, not a returns promise. |
| 7:15–8:00 | Close | The journey in one breath: our researcher stress-tests before publishing; our client watches the case against before buying; the platform that shows both sides keeps the client. Live-site URL/QR up. |

Deliberate choices: demo gets half the time (differentiators are *visible*,
footage beats slides); the ChatGPT question is disarmed before Q&A; URL/QR at
the **close**, not the start (phones-out during the narrated arc kills it).
Dependency: rehearse against the act-break player (#11 increment) — one
presents, one drives, or solo with the keyboard.

## Data provenance — the exact answer (know this cold)

Where every datum comes from (source: `backend/alpha_swarms/ingest.py`,
`snapshot.py`):

- **Prices:** Yahoo Finance (via yfinance) — one year of daily OHLCV bars up
  to and including the as-of date.
- **Fundamentals:** Yahoo Finance quarterly income statement + balance sheet —
  but only the last quarter *reported* before the as-of date, with
  availability stamped `period_end + 45 days` (the 10-Q filing deadline).
  Conservative by design: a quarter that ended but wasn't yet filed as of the
  date **cannot** enter the snapshot.
- **News:** Finnhub company-news API — date-ranged *historical* headlines +
  summaries with stable IDs (30-day lookback, capped at 50 items), so the
  swarm reads what was actually published before the as-of date. Falls back to
  yfinance current headlines if no Finnhub key.
- **Outcome:** yfinance prices for 30 days *after* as-of, stored in a separate
  file nothing on the run path reads (+ the actual earnings print, added
  manually for demo pairs per #10).

Everything is fetched **offline or on-demand before any agent runs**,
leak-validated on save (no datum dated after as-of), and agents only ever read
the snapshot — never a live API.

**If asked about data quality:** free-tier sources are a hackathon scope
choice, not an architecture. The Snapshot schema *is* the vendor abstraction —
swapping in a licensed feed (Polygon, FMP, Refinitiv/FactSet) is one fetcher
function per source; the grounding, citation, and point-in-time machinery
don't change. Known soft spot: news is headlines + summaries, not full
articles (flagged for #10 review).

## Target-audience journey (decided — internal-hackathon context)

**Context that reframes the pitch:** this is an internal hackathon; the
company is a retail investing platform whose in-house researchers publish
reports/ideas that retail clients read in-app, and judges reward
**client-facing innovation**.

**The reconciling principle:** the researcher is the *operator*, the client is
the *beneficiary*. Clients consume **published debates**; they never convene
the swarm. This preserves every earlier decision (augmentation,
stress-test-not-support, no self-serve advice trap) while still shipping a
client-facing feature — the client-facing innovation is the *artifact*, not
tool access. The researcher stays the gatekeeper: same compliance envelope as
the human research they already publish.

### The journey (one slide, five beats)

| # | Actor | Beat |
|---|---|---|
| 1 | Researcher | **Sweep** — pre-open run over the covered/most-held names (~30s each); flagged only where the verdict changed or Dissent flipped vs. yesterday |
| 2 | Researcher | **Stress-test** — drafting a report, convenes the swarm on their thesis; the bear case is forced into the record; they revise or publish stronger |
| 3 | Researcher → platform | **Publish** — the report ships with the debate attached: cited evidence trail, conviction + dissent, the strongest opposing case, "what would change our mind" |
| 4 | Client | **Watch** — on the stock page in-app, next to the human report, the client plays the **interactive debate replay**: watches the bull/bear fight, the verified citations, the honest No Call when evidence is thin |
| 5 | Client | **Decide & return** — trades informed on-platform; "what would change our mind" is a built-in re-engagement trigger (they come back when that thing happens) |

**Why the judges should care (the internal business case):**
- **Differentiation:** "the only platform that shows you the case *against*
  a stock before you buy" — competitor research is static PDFs and ratings.
- **Engagement:** debate replays are watchable content on stock pages, not
  documents; beat 5 creates recurring return visits.
- **Trust/retention:** a platform that publishes No Calls and bear cases is
  credibly on the client's side — trust is the retail-brokerage retention
  currency.
- **Research leverage:** the desk covers more names at the same headcount
  (beat 1) and publishes more defensible work (beat 2–3).

**The demo convergence (say this on stage):** the static replay site being
demoed *is* the client experience — "what you're watching right now is what a
client would see on the stock page." The demo is no longer insurance; it's the
product.

**Explicitly rejected:** client self-serve swarm access (arbitrary-ticker
convening). It converts published research into on-demand unlicensed advice,
invites the rationalization-engine failure mode, and breaks the
researcher-as-gatekeeper compliance story. If asked "why can't users run it
themselves?" — that *is* the roadmap's last step, but only behind the same
review a human research note gets today; curation is the product, not a
limitation.

*(If ever pitched externally instead: the desk pays per seat, B2B — the
journey above is the same with "platform" swapped for "fund" and beat 4's
surface being client letters.)*

## Real-time — the roadmap answer (decided)

Point-in-time is a *discipline*, not a delay. "As-of = today" is just a
snapshot built this morning — the on-demand build (ADR 0006, `POST /snapshots`)
already does this. So real-time elements are additive, not a redesign:

1. **Event-triggered convocations** — an earnings release, 8-K, or headline
   spike auto-convenes the swarm on that name; the verdict lands minutes
   later.
2. **Morning coverage sweep** — run the whole coverage list pre-open (~30s a
   name, cheap in parallel); alert only where the verdict *changed* or
   Dissent flipped vs. yesterday. The day-over-day delta is the signal.
3. **Auditability survives live mode** — every verdict stays permanently bound
   to the exact snapshot it saw, so "what did we know when we said this?" is
   always answerable.

What it is **not**: tick-level / HFT. The product is reasoned research;
30-second latency is a feature (it's the depth), not a bug.

## Q&A prep — the hard questions and the agreed answers

1. **"Didn't the model already know the outcome from training data?"**
   Two layers. Proof: demo pairs are curated so the as-of date *and* Outcome
   window post-date the model's training cutoff (hard #10 criterion) — the
   outcome literally isn't in the weights. Design: even if it were, memory
   doesn't earn a vote — every claim must cite and value-match the dated
   snapshot or it's dropped. Stances are earned from citable evidence, not
   recalled.
2. **"Did you cherry-pick the demo?"** "Of course — it's a demo of process,
   and n=1 proves nothing about returns either way; that's why we sell process
   quality, not alpha. Here's a run where it said No Call." (Backed by the
   published unflattering run.)
3. **"What's the track record? Would you trade on it?"** No alpha claim — the
   sample is tiny and we won't pretend otherwise. What we built is the thing
   that makes track records *measurable*: replay any historical day
   (post-cutoff), grade the process at scale. The eval harness is the roadmap.
4. **"Why multiple agents instead of one good prompt?"** (Deeper version of
   the pre-empted slide.) One model asked for both sides anchors on its first
   idea; parallel no-shared-context specialists have genuinely independent
   priors. And the components that make it trustworthy — the grounding gate,
   the computed verdict — aren't prompts at all; they're deterministic code
   sitting *between* the models.
5. **"All your agents are the same base model — correlated blind spots?"**
   Honest yes: shared weights share biases. Mitigations today: independent
   contexts per lens, a deterministic gate no model can talk past, and Dissent
   surfaced rather than averaged away. Roadmap: heterogeneous models per lens
   — the architecture treats a lens as a node + prompt + tools, so swapping
   the model behind one lens is trivial.
6. **"What does a run cost? Does this scale?"** ~$0.60–1.10 per full run on
   Sonnet today, before prompt caching (~90% off cached input) and batch (50%
   off) — call it cents-per-name at scale, against analyst-hours. The 30s run
   time is the coverage story, not a corner cut: the debate is fixed-shape by
   design (assert → attack → one rebuttal → adjudicate).
7. **"Is this financial advice? Regulatory exposure?"** Clients never generate
   output — they read debates our researchers convened, reviewed, and chose to
   publish, exactly like the human research notes we publish today; same
   compliance envelope, same gatekeeper. And an evidence trail where every
   claim resolves to a dated source is compliance-*friendly*: it's the first
   research format that shows the client the case against, not just the call.
8. **"Why these three lenses? Where's macro?"** Deliberate 1-week scope cut. A
   lens is a node + prompt + tools; adding macro (or credit, or options flow)
   is additive, not architectural. Quorum and the aggregate already generalize
   to N lenses.
9. **"What's next?"** In order: the eval harness (grade the process against
   history at scale, respecting training cutoffs); more + heterogeneous
   lenses; escalation — spend more debate rounds only where Dissent is high,
   which is exactly where extra reasoning pays.
10. **"Where does the data come from?"** The exact provenance answer above —
    prices + reported-only fundamentals from Yahoo Finance, historical
    date-ranged news from Finnhub, all snapshotted and leak-validated before
    any agent runs. Free-tier sources are scope, not architecture: the
    Snapshot schema is the vendor abstraction; a licensed feed is one fetcher
    per source.
11. **"What's the business case for us?"** Three lines: research leverage
    (the desk sweeps its whole coverage list daily at ~30s a name),
    differentiated client product (interactive debates on stock pages vs.
    competitors' static PDFs — the case *against* before you buy), and
    retention (trust + the "what would change our mind" re-engagement loop).
    See the journey section.
12. **"Why can't clients run it themselves?"** They will be able to — behind
    the same review a human research note gets today. Curation is the product:
    an on-demand swarm is unlicensed advice; a published, researcher-reviewed
    debate is research. Gatekeeping is the compliance story, not a limitation.
13. **"Could this run in real time?"** As-of = today is just a snapshot built
    this morning (the on-demand build already exists). Roadmap: event-triggered
    convocations (earnings/8-K auto-convene) and the pre-open sweep alerting
    on verdict *changes*. Not tick-level — 30-second latency is the depth.
