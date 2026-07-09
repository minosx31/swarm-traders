/** The data-provenance manifest: a single readout of WHAT the swarm is working
 *  from — the point-in-time snapshot in play, how much of the cited evidence
 *  actually grounded, and how many lenses earned a vote. Purely derived from the
 *  reducer state + the selected pair; it never touches the sealed Outcome.
 *
 *  When a SnapshotManifest has loaded (GET /snapshot), the strip also surfaces
 *  compact chips summarizing exactly what was fed to the agents (bars of price
 *  history, the fundamentals period, news count, and the leak-check result), plus
 *  a "VIEW MANIFEST" toggle that expands the raw keys/news the swarm cited against. */

import { useState } from 'react'
import { fmtVal } from './components'
import { SPECIALISTS } from './types'
import type { SnapshotManifest } from './types'
import type { DebateState } from './reducer'

export function Provenance({ state, ticker, asOf, manifest }: {
  state: DebateState
  ticker: string
  asOf: string
  manifest?: SnapshotManifest | null
}) {
  const [showManifest, setShowManifest] = useState(false)
  const lanes = SPECIALISTS.map((s) => state.lanes[s])
  const grounded = lanes.reduce((n, l) => n + (l.grounding?.grounded ?? 0), 0)
  const dropped = lanes.reduce((n, l) => n + (l.grounding?.dropped ?? 0), 0)
  const cited = grounded + dropped
  const voting = lanes.filter((l) => l.grounding?.gated_in).length
  const gatesIn = lanes.filter((l) => l.grounding).length
  const started = state.phase !== 'idle'
  const pct = cited > 0 ? Math.round((grounded / cited) * 100) : 0

  const violations = manifest?.leak_check.violations.length ?? 0

  return (
    <div className="flex flex-col border-b border-hairline bg-surface/60">
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-[30px] py-[11px]">
      <div className="flex items-center gap-2">
        <span className="rounded-[4px] border border-hairline px-2 py-[3px] font-mono text-[9.5px] font-semibold tracking-[0.16em] text-ink-3">
          SNAPSHOT
        </span>
        {ticker && asOf ? (
          <span className="tnum text-[14px] text-ink">
            <span className="font-semibold">{ticker}</span>
            <span className="mx-1.5 text-ink-3">·</span>
            <span className="text-ink-2">{manifest ? `frozen ${manifest.as_of}` : `as-of ${asOf}`}</span>
          </span>
        ) : (
          <span className="text-[13px] italic text-ink-3">no pair selected</span>
        )}
      </div>

      {manifest && (
        <>
          <span className="h-4 w-px bg-hairline" aria-hidden />
          {/* compact mono chips — what the swarm was actually fed */}
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-ink-2">
            <span className="rounded-[4px] border border-hairline px-1.5 py-[2px]">
              Prices — {manifest.prices.bars}d EOD
            </span>
            <span className="rounded-[4px] border border-hairline px-1.5 py-[2px]">
              Fundamentals — {manifest.fundamentals ? `${manifest.fundamentals.period_end} (10-Q)` : 'none reported'}
            </span>
            <span className="rounded-[4px] border border-hairline px-1.5 py-[2px]">
              News — {manifest.news.length} sources · cutoff enforced
            </span>
            <span
              className="rounded-[4px] border px-1.5 py-[2px]"
              style={violations === 0
                ? { borderColor: 'color-mix(in oklab, var(--color-judge) 45%, transparent)', color: 'var(--color-judge)' }
                : { borderColor: 'color-mix(in oklab, var(--color-bear) 45%, transparent)', color: 'var(--color-bear)' }}
            >
              {violations === 0 ? '✓ ' : ''}{violations} sources post-date as-of
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowManifest((v) => !v)}
            className="cursor-pointer font-mono text-[10.5px] font-semibold tracking-[0.12em] text-ink-3 transition-colors hover:text-judge"
          >
            VIEW MANIFEST {showManifest ? '▾' : '→'}
          </button>
        </>
      )}

      <span className="h-4 w-px bg-hairline" aria-hidden />

      {/* grounded ratio — how much cited data survived validation */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] tracking-[0.18em] text-ink-3">GROUNDED</span>
        {cited > 0 ? (
          <>
            <span className="tnum text-[14px] font-semibold text-judge">{grounded}</span>
            <span className="tnum text-[13px] text-ink-3">/ {cited}</span>
            <span className="relative h-[6px] w-16 overflow-hidden rounded-xs bg-raised" role="img"
                  aria-label={`${grounded} of ${cited} citations grounded (${pct}%)`}>
              <span className="meter-fill absolute inset-y-0 left-0 rounded-xs bg-judge"
                    style={{ width: `${pct}%` }} />
            </span>
            {dropped > 0 && (
              <span className="tnum text-[12px] text-bear/80">{dropped} dropped</span>
            )}
          </>
        ) : (
          <span className="text-[13px] text-ink-3">{started ? 'awaiting citations…' : '—'}</span>
        )}
      </div>

      <span className="h-4 w-px bg-hairline" aria-hidden />

      {/* voting lenses — how many specialists earned a vote (quorum ≥ 2) */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] tracking-[0.18em] text-ink-3">VOTING LENSES</span>
        <span className="tnum text-[14px] font-semibold text-ink">
          {gatesIn > 0 ? voting : '—'}
          <span className="text-[13px] font-normal text-ink-3"> / {SPECIALISTS.length}</span>
        </span>
        {gatesIn > 0 && voting < 2 && (
          <span className="text-[11px] font-semibold tracking-[0.14em] text-bear/80">
            {started && state.verdict ? 'NO QUORUM' : 'BELOW QUORUM'}
          </span>
        )}
      </div>

      {ticker && (
        <>
          <span className="h-4 w-px bg-hairline" aria-hidden />
          {/* data origin — attribution, not the point-in-time datum itself */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] tracking-[0.18em] text-ink-3">SOURCE</span>
            <a
              href={`https://finance.yahoo.com/quote/${ticker}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-fundamentals hover:underline"
            >
              Yahoo Finance ↗
            </a>
          </div>
        </>
      )}

      <span className="ml-auto flex items-center gap-2 text-[10px] tracking-[0.14em] text-ink-3">
        POINT-IN-TIME ≤ AS-OF
        <span className="text-ink-3/40" aria-hidden>·</span>
        <span style={{ color: 'var(--color-neutralpole)' }}>◈ OUTCOME SEALED</span>
      </span>
    </div>

    {showManifest && manifest && <ManifestPanel manifest={manifest} />}
    </div>
  )
}

/** The expanded manifest: every key the swarm could cite against, plus the
 *  news it was fed — dense, monospace, so a reader can line a citation up
 *  against exactly what was in scope. */
function ManifestPanel({ manifest }: { manifest: SnapshotManifest }) {
  return (
    <div className="border-t border-hairline px-[30px] py-[14px] font-mono text-[11px]">
      <div className="flex flex-wrap gap-x-10 gap-y-4">
        <div className="min-w-[220px]">
          <div className="flex items-center gap-2">
            <span className="tracking-[0.14em] text-ink-3">FUNDAMENTALS</span>
            {manifest.fundamentals ? (
              <a href={manifest.fundamentals.source_url} target="_blank" rel="noopener noreferrer"
                 className="text-fundamentals hover:underline">
                ↗ Yahoo Finance
              </a>
            ) : (
              <span className="text-ink-3">none reported</span>
            )}
          </div>
          {manifest.fundamentals && (
            <div className="mt-1.5 flex flex-col gap-[3px]">
              {Object.entries(manifest.fundamentals.keys).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <span className="break-all text-ink-3">{k}</span>
                  <span className="shrink-0 text-ink">{fmtVal(v)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-[220px]">
          <div className="flex items-center gap-2">
            <span className="tracking-[0.14em] text-ink-3">TECHNICALS</span>
            <a href={manifest.prices.source_url} target="_blank" rel="noopener noreferrer"
               className="text-fundamentals hover:underline">
              ↗ Yahoo Finance
            </a>
          </div>
          <div className="mt-1.5 flex flex-col gap-[3px]">
            {Object.entries(manifest.technicals.keys).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <span className="break-all text-ink-3">{k}</span>
                <span className="shrink-0 text-ink">{fmtVal(v)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-[260px] flex-1">
          <span className="tracking-[0.14em] text-ink-3">NEWS</span>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {manifest.news.length === 0 && <span className="text-ink-3">no cached news</span>}
            {manifest.news.map((n) => (
              <div key={n.source_id} className="flex items-baseline gap-2">
                <span className="shrink-0 text-ink-3">{n.published_at}</span>
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noopener noreferrer"
                     className="min-w-0 truncate text-ink-2 hover:text-fundamentals hover:underline">
                    {n.title}
                  </a>
                ) : (
                  <span className="min-w-0 truncate text-ink-2">{n.title}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
