# The swarm sees only point-in-time data; the outcome is held out of agent state

**Status:** accepted

A run is anchored to an **As-Of Date**. The swarm sees a single curated
**Snapshot** in which every datum — prices, news, financials — is dated on or
before that date. Nothing dated after the As-Of Date may reach any agent, and the
actual **Outcome** (what happened next) lives entirely outside agent-visible state,
revealed by the UI only after the Verdict. Snapshots are hand-curated for a
whitelist of 2–3 (ticker, date) pairs; runs never live-fetch.

## Why

The earnings-post-mortem demo ("run as of the day before earnings, then reveal")
is only credible if the agents genuinely could not see the future. The data
sources leak it by default: news APIs return post-date headlines, and TTM/latest
financials silently include the not-yet-reported quarter. A single leaked datum
turns a real prediction into a fake one — and any judge who knows the stock will
catch it. Holding the Outcome out of the blackboard prevents an agent from citing
the answer it is supposed to predict.

## Consequences

- Snapshots must stamp every field/headline with an availability date; the
  fundamentals shown are the last ones *reported* before the As-Of Date, not the
  latest period.
- Curation is manual and does not generalize — correctness rests on eyeballing 3
  snapshots for leakage (~30 min each), not on a point-in-time data engine.
- The open ticker+date input is backed by a whitelist; an uncached name is
  refused, never live-fetched (which would both leak and burn budget). Arbitrary
  live input is explicitly "what we'd scale to with a point-in-time data vendor."

## Rejected

- **A real point-in-time data pipeline** (paid vendor / as-of reconstruction):
  correct and general, but far outside a 1-week build.
- **Live-fetching on demand for uncached tickers**: leaks future data and spends
  unbudgeted API credits mid-demo.
