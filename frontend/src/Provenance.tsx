/** The data-provenance manifest: a single readout of WHAT the swarm is working
 *  from — the point-in-time snapshot in play, how much of the cited evidence
 *  actually grounded, and how many lenses earned a vote. Purely derived from the
 *  reducer state + the selected pair; it never touches the sealed Outcome. */

import { SPECIALISTS } from './types'
import type { DebateState } from './reducer'

export function Provenance({ state, ticker, asOf }: {
  state: DebateState
  ticker: string
  asOf: string
}) {
  const lanes = SPECIALISTS.map((s) => state.lanes[s])
  const grounded = lanes.reduce((n, l) => n + (l.grounding?.grounded ?? 0), 0)
  const dropped = lanes.reduce((n, l) => n + (l.grounding?.dropped ?? 0), 0)
  const cited = grounded + dropped
  const voting = lanes.filter((l) => l.grounding?.gated_in).length
  const gatesIn = lanes.filter((l) => l.grounding).length
  const started = state.phase !== 'idle'
  const pct = cited > 0 ? Math.round((grounded / cited) * 100) : 0

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-hairline bg-surface/60 px-[30px] py-[11px]">
      <div className="flex items-center gap-2">
        <span className="rounded-[4px] border border-hairline px-2 py-[3px] font-mono text-[9.5px] font-semibold tracking-[0.16em] text-ink-3">
          SNAPSHOT
        </span>
        {ticker && asOf ? (
          <span className="tnum text-[14px] text-ink">
            <span className="font-semibold">{ticker}</span>
            <span className="mx-1.5 text-ink-3">·</span>
            <span className="text-ink-2">as-of {asOf}</span>
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
  )
}
