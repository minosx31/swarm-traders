/** The right rail: verdict stamp, conviction + N + dissent, then Outcome reveal. */

import { useState } from 'react'
import { fetchOutcome } from './api'
import { SectionTag, StanceMeter } from './components'
import type { DebateState } from './reducer'
import type { Outcome } from './types'

const DIRECTION_STYLE: Record<string, { word: string; color: string; sign: string }> = {
  bull: { word: 'BULL', color: 'var(--color-bull)', sign: '▲' },
  bear: { word: 'BEAR', color: 'var(--color-bear)', sign: '▼' },
  neutral: { word: 'NEUTRAL', color: 'var(--color-neutralpole)', sign: '◆' },
  no_call: { word: 'NO CALL', color: 'var(--color-ink-3)', sign: '∅' },
}

export function VerdictPanel({ state, ticker, asOf }: {
  state: DebateState
  ticker: string
  asOf: string
}) {
  const verdict = state.verdict
  const landed = Object.values(state.lanes).flatMap(
    (lane) => lane.adjudication?.attacks_landed ?? [],
  )

  return (
    <aside className="flex min-w-0 flex-col gap-4 border-l border-hairline bg-surface p-4">
      <SectionTag>VERDICT</SectionTag>

      {!verdict && (
        <p className="text-[11px] text-ink-3">
          {state.phase === 'streaming' ? (
            <>the swarm is deliberating<span className="thinking-dot">▊</span></>
          ) : (
            'no run yet'
          )}
        </p>
      )}

      {verdict && (
        <div className="card-in flex flex-col gap-4">
          <div className="flex items-center justify-center py-3">
            <div
              className="stamp border-[3px] px-6 py-2 text-center font-display text-4xl tracking-wide"
              style={{ borderColor: DIRECTION_STYLE[verdict.direction].color,
                       color: DIRECTION_STYLE[verdict.direction].color }}
            >
              {DIRECTION_STYLE[verdict.direction].sign} {DIRECTION_STYLE[verdict.direction].word}
              {verdict.high_conviction && (
                <div className="text-[10px] font-mono font-semibold tracking-[0.3em]">
                  HIGH CONVICTION
                </div>
              )}
            </div>
          </div>

          {verdict.direction === 'no_call' ? (
            <p className="text-[11.5px] text-ink-2">
              Honest abstention — {verdict.reason}. The swarm does not force a number it
              cannot ground.
            </p>
          ) : (
            <>
              <StanceMeter value={verdict.aggregate_stance ?? 0} label="aggregate" />
              {/* Conviction is NEVER shown without N and dissent */}
              <div className="grid grid-cols-3 gap-2 border-y border-hairline py-2 text-center">
                <Stat label="CONVICTION" value={(verdict.conviction ?? 0).toFixed(2)} />
                <Stat label="VOTING LENSES" value={`N=${verdict.voting_lenses}`} />
                <Stat label="DISSENT" value={(verdict.dissent ?? '—').toUpperCase()} />
              </div>
            </>
          )}

          <div>
            <SectionTag>WHAT WOULD CHANGE OUR MIND</SectionTag>
            {landed.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {landed.map((critique, i) => (
                  <li key={i} className="border-l border-redteam/60 pl-2 text-[11px] text-ink-2">
                    {critique}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-ink-3">no attacks landed this run</p>
            )}
          </div>

          <OutcomeReveal ticker={ticker} asOf={asOf} />
        </div>
      )}
    </aside>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] tracking-[0.2em] text-ink-3">{label}</div>
      <div className="tnum text-[15px] font-semibold text-ink">{value}</div>
    </div>
  )
}

/** Absent from the DOM until requested, and requestable only after the verdict. */
function OutcomeReveal({ ticker, asOf }: { ticker: string; asOf: string }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (outcome) {
    const prices = outcome.prices_after
    if (prices.length === 0) {
      return <p className="text-[11px] text-ink-3">outcome window has no trading days yet</p>
    }
    const first = prices[0].close
    const last = prices[prices.length - 1].close
    const change = (last / first - 1) * 100
    const color = change >= 0 ? 'var(--color-bull)' : 'var(--color-bear)'
    return (
      <div className="card-in border border-hairline bg-raised p-3">
        <SectionTag>THE OUTCOME — what actually happened</SectionTag>
        <div className="tnum font-display text-3xl" style={{ color }}>
          {change >= 0 ? '▲ +' : '▼ '}{change.toFixed(1)}%
        </div>
        <p className="mt-1 text-[10.5px] text-ink-3">
          {prices[0].date} close {first.toFixed(2)} → {prices[prices.length - 1].date} close{' '}
          {last.toFixed(2)} · {prices.length} sessions after as-of
        </p>
      </div>
    )
  }

  return (
    <div>
      <button
        className="w-full cursor-pointer border border-hairline bg-raised px-3 py-2 text-[11px] font-semibold tracking-[0.2em] text-ink-2 transition-colors hover:border-judge hover:text-judge"
        onClick={() =>
          fetchOutcome(ticker, asOf).then(setOutcome, (e) => setError(String(e.message ?? e)))
        }
      >
        ▣ REVEAL THE OUTCOME
      </button>
      <p className="mt-1 text-[9.5px] text-ink-3">
        held outside agent-visible state for the entire run
      </p>
      {error && <p className="mt-1 text-[10.5px] text-bear">{error}</p>}
    </div>
  )
}
