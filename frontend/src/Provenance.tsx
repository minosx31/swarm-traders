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

      {manifest && (
        <button
          type="button"
          onClick={() => setShowManifest((v) => !v)}
          aria-expanded={showManifest}
          className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-hairline bg-raised px-3 py-[5px] font-mono text-[10.5px] font-semibold tracking-[0.12em] text-ink-2 transition-colors hover:border-judge hover:text-judge"
        >
          VIEW MANIFEST <span aria-hidden>{showManifest ? '▾' : '▸'}</span>
        </button>
      )}
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
