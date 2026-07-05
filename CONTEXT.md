# Alpha Swarms — Domain Language

The shared vocabulary for the swarm-of-analysts research system. This file is a
glossary only: what each term *means*, not how it is implemented. Implementation
lives in `context.md` and `docs/adr/`.

## Language

**Thesis**:
A single specialist agent's directional view on a stock, carrying a direction
(long / short / neutral), a conviction, and cited evidence. One specialist
produces one thesis per run.
_Avoid_: opinion, call, recommendation (the run's *final* output is the Verdict, not a thesis).

**Debate**:
A fixed two-turn adversarial exchange, not an open-ended loop: (1) specialists
assert theses, (2) the Red-Team attacks each thesis, then each specialist gets a
single Rebuttal to defend or revise. There is exactly one rebuttal turn.
_Avoid_: discussion, conversation, multi-round debate (multi-round is explicitly out of scope).

**Rebuttal**:
A specialist's one and only response to the Red-Team's attack: its defence of the
thesis plus a *proposed* revised stance. It is advocacy, not the final word — the
Judge, not the specialist, sets the authoritative stance. No further exchange follows.

**Snapshot**:
The curated, point-in-time bundle of data for one (ticker, As-Of Date): prices,
fundamentals, and news, every datum dated on or before the As-Of Date. The only
data the swarm ever sees. Drawn from a whitelist; never live-fetched during a run.

**As-Of Date**:
The point in time a run simulates. Nothing dated after it — no price, headline, or
unreported financial — may reach the swarm.

**Outcome**:
What actually happened over a *bounded horizon* after the As-Of Date — the
catalyst's reaction window (e.g. the reported earnings figures plus the next
few trading days' move), fixed when the pair is curated. Not "the price today":
a Verdict is a call on a defined window; drift beyond it is confounded by
everything since. Held entirely outside agent-visible state and revealed by the
UI only after the Verdict. Never enters the Snapshot or the blackboard.
_Avoid_: result, actual, answer (in glossary use "Outcome" for the held-out reveal).

**Evidence**:
A claim paired with a citation. Numeric tier: `{claim, citation_key, cited_value}`
pointing at a keyed snapshot field. Textual tier: `{claim, source_id, quoted_span}`
pointing at a cached headline/article.

**Grounded Evidence**:
Evidence that passed its tier's deterministic check — numeric value-match (within
tolerance) or textual source-existence. A specialist must hold ≥1 Grounded
Evidence item to earn a vote in the Aggregate Stance; a specialist with none is
excluded entirely. Grounding is a gate on voting, not a continuous weight.
Ungrounded evidence items are dropped before scoring.
_Avoid_: valid, verified (reserve "verified" for the quote badge below).

**Verified Quote**:
A display badge on textual evidence whose `quoted_span` is an exact substring of
the cited source. A badge, not a gate — its absence does not drop the evidence.

**Red-Team**:
The agent that attacks every gated-in specialist thesis with the strongest
available counter-case, held to the *same* grounding standard as the specialists.
It does not hold a directional view of its own.
_Avoid_: critic, devil's advocate, bear (the bear *case* is an output; Red-Team is the role).

**Attack**:
A Red-Team challenge to a specific thesis claim or stance. Two kinds:
*evidence-backed* (supplies its own Grounded counter-evidence, same two-tier rule)
or *logical* (exposes an internal flaw — a thesis contradicting its own cited
numbers, over-extrapolating, or ignoring a datum already in the Snapshot; no new
evidence needed). The Judge counts an Attack as *landed* only if it is grounded
counter-evidence or a valid logical flaw — never unsupported doubt.

**Verdict**:
The run's single final output: a direction, a conviction, a dissent measure, and
a cited evidence trail. Assembled from the Judge's adjudicated stances plus the
computed Aggregate Stance, one per run.
_Avoid_: decision, result, recommendation, thesis.

**Judge**:
The neutral adjudicator. Rules which attacks landed, sets each specialist's
Adjudicated Stance, writes the dissent narrative, and assembles the evidence
trail. It does not advocate a direction of its own, and it does not author the
headline conviction number (that is computed).
_Avoid_: referee, arbiter, synthesizer.

**Stance**:
A specialist's signed position on a stock in [−1, +1]. Sign is the direction
(negative = bear, positive = bull); magnitude is the strength. Replaces the old
two-field "direction + conviction" split at the specialist level.

**Adjudicated Stance**:
A specialist's final stance as set by the Judge after weighing thesis + attack +
rebuttal — not the specialist's own proposed stance. The Judge also rules, per
attack, whether it landed. The Judge sets these per-specialist inputs; it does
*not* emit the headline number.

**Aggregate Stance**:
The plain mean of the *Adjudicated* stances of every specialist that cleared the
grounding gate (one lens, one equal vote) — one number in [−1, +1], analogous to a
sell-side consensus mean recommendation. Computed arithmetically, never authored
by the Judge. Direction, Conviction, and Dissent are all views of this single
quantity, so they cannot contradict each other.

**Direction**:
The banded Aggregate Stance: Bear (< −0.25), Neutral (−0.25 … +0.25), or Bull
(> +0.25). Bands follow the Refinitiv/Yahoo Hold convention (2.5–3.5 on a 1–5
scale). |Stance| > 0.75 is flagged "high-conviction". Default, tunable.
_Avoid_: buy/sell/hold as the *stored* value (those are display labels for the bands).

**Conviction**:
The absolute value of the Aggregate Stance, mapped to 0–1 — how far the swarm's
consensus sits from neutral. It is a property of the *swarm*, not confidence of a
single agent. Always shown alongside Dissent, never alone.

**Dissent**:
The spread of the *voting* (gated-in) specialists' Adjudicated stances, reported
as a qualitative band — Low / Medium / High — not a false-precision decimal, since
it is measured over at most three points. Always shown alongside N (the count of
voting lenses). High Dissent with low Conviction is the honest signal on a
contested stock, not a failure.
_Avoid_: disagreement, conflict (fine in prose, but Dissent is the measured term).

**No Call**:
The Verdict when fewer than two specialists cleared the grounding gate (quorum
not met). An explicit, honest abstention — "insufficient grounded evidence" — not
an error or a failed run.
_Avoid_: hold, neutral (No Call means *not enough to judge*; Neutral means *judged and balanced*).
