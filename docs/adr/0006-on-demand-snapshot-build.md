# Snapshots build on demand before a run; the whitelist becomes a build-once cache

**Status:** accepted

`POST /snapshots?ticker&as_of` runs the same ingestion pipeline as
`build_snapshot.py` (extracted into `alpha_swarms/ingest.py`): fetch prices +
fundamentals (yfinance) and news (Finnhub when `FINNHUB_API_KEY` is set, else
yfinance), leak-validate, persist. An existing snapshot returns immediately —
each pair is fetched once and reused forever. The UI calls it before opening the
stream for a non-whitelisted pair, so a new `(ticker, as_of)` "just works".
`/stream` itself still refuses pairs with no snapshot on disk.

## Why

ADR 0002 rejected on-demand fetching when point-in-time filtering lived in ad-hoc
script code and any fetch during a request could reach agents. Both objections
have since been engineered away: the ingestion pipeline enforces availability
stamps by construction, `save_snapshot` refuses leaky data outright, and the
build completes *before* the graph starts — agents still only ever see a
validated on-disk Snapshot. The data APIs involved are free-tier, so there is no
unbudgeted spend. What remains true: hand-eyeballing stays the bar for the
curated demo pairs (#10); auto-built pairs are a dev/exploration convenience that
inherit the automated leak check only.

## Consequences

- The whitelist semantics shift from "refusal list" to "cache": an uncached pair
  is built (seconds), not refused; a pair that *cannot* be built (bad ticker, no
  price data, Finnhub failure, leak-check violation) still gets a `400` with the
  reason.
- The automated leak check is the only gate on auto-built snapshots. Residual
  risk — e.g. a provider back-dating revised content — is accepted for dev pairs;
  demo pairs are still manually reviewed per ADR 0002.
- Ingestion code is importable (`alpha_swarms/ingest.py`); the CLI is a thin
  wrapper, so both paths cannot drift.

## Rejected

- **Auto-building inside `GET /stream`**: EventSource cannot surface a 400 body,
  and mixing a multi-second sync fetch into the SSE endpoint muddies the run
  path. A separate POST keeps build failures readable and the stream contract
  untouched.
- **Gating behind an env flag**: an explicit POST is already deliberate; a flag
  would just be a second switch to forget.
