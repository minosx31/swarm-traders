# Advocacy and adjudication are separate; the headline number is computed, not authored

**Status:** accepted

Specialists **advocate** (assert a thesis, then defend it in one rebuttal with a
*proposed* stance) but never finalize their own outcome. A single neutral **Judge
adjudicates**: it rules which Red-Team attacks landed and sets each specialist's
final *Adjudicated Stance*. The headline **conviction is then computed
arithmetically** as the plain mean of those adjudicated stances — one equal vote
per specialist that cleared the grounding gate (the Aggregate Stance); Direction
and Dissent are derived from the same quantity. The Judge never authors the
top-line number.

## Why

Two forks drove this:

1. **Who decides an attack landed?** Letting the Red-Team self-score means it
   always wins; letting the attacked specialist self-score means it always
   survives. A neutral Judge is the only adjudicator that isn't structurally
   biased.
2. **Where does the conviction number come from?** A Judge that simply *states*
   "0.62" is a black box whose number can contradict the specialist stances shown
   on screen — fatal for a demo whose whole pitch is transparent, auditable
   reasoning. Making the number a deterministic aggregate over per-specialist
   (visible) stances guarantees conviction and dissent can never disagree with
   what the user sees, and keeps runs reproducible for pre-recorded/replay demos.

## Consequences

- The **Judge is the highest-leverage prompt and a single point of failure** —
  tune it first when the Sonnet budget opens up.
- Specialist output must carry a structured, source-checked evidence list
  (`citation_key` + `value`) so grounding can gate whether a specialist votes at
  all; fabrication is caught deterministically before adjudication (see grounding
  split). Grounding gates the vote; it is not a continuous weight.
- The demo gains a visible beat: specialist self-scores 0.7, Judge rules an attack
  landed and marks it to 0.4 — advocacy vs ruling shown side by side.

## Rejected

- **Specialist owns its stance revision** (no central Judge): simpler graph, but
  relies on a stubborn prompt honestly conceding against itself.
- **Judge emits the headline conviction directly**: less code, but reintroduces
  the black-box-number problem above.
