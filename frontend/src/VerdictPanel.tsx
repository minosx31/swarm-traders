/** The right rail: verdict stamp, aggregate BEAR↔BULL axis, conviction + N +
 *  dissent, what-would-change-our-mind, then the sealed → unsealed Outcome. */

import { useState } from 'react'
import { fetchOutcome } from './api'
import { AGENT_COLOR, poleColor, SectionTag } from './components'
import type { DebateState } from './reducer'
import { SPECIALISTS, type Outcome, type Specialist } from './types'

const DIRECTION_STYLE: Record<string, { word: string; color: string; icon: string }> = {
  bull: { word: 'BULL', color: 'var(--color-bull)', icon: '▲' },
  bear: { word: 'BEAR', color: 'var(--color-bear)', icon: '▼' },
  neutral: { word: 'NEUTRAL', color: '#d9a441', icon: '◈' },
  no_call: { word: 'NO CALL', color: 'var(--color-ink-3)', icon: '∅' },
}

const LENS_LABEL: Record<Specialist, string> = {
  fundamentals: 'FUND',
  sentiment: 'SENT',
  technicals: 'TECH',
}

const DISSENT_COLOR: Record<string, string> = {
  low: 'var(--color-judge)',
  med: '#d9a441',
  high: 'var(--color-bear)',
}

const SEALED = '#d9a441'

export function VerdictPanel({ state, ticker, asOf }: {
  state: DebateState
  ticker: string
  asOf: string
}) {
  const verdict = state.verdict
  const landed = SPECIALISTS.flatMap((s) =>
    (state.lanes[s].adjudication?.attacks_landed ?? []).map((critique) => ({ lens: s, critique })),
  )

  return (
    <aside
      className="flex min-w-0 flex-col gap-5 border-l border-t-2 p-5"
      style={{ background: 'linear-gradient(180deg,#0b0e0c,#090b0a)', borderTopColor: 'rgba(242,244,239,0.2)', borderLeftColor: 'var(--color-hairline)' }}
    >
      <SectionTag>VERDICT</SectionTag>

      {!verdict && (
        <p className="text-[13px] text-ink-3">
          {state.phase === 'streaming' ? (
            <>the swarm is deliberating<span className="thinking-dot">▊</span></>
          ) : (
            'no run yet'
          )}
        </p>
      )}

      {verdict && (
        <div className="card-in flex flex-col gap-6">
          {/* the stamp */}
          <div className="flex justify-center py-1">
            <div
              className="stamp flex items-center gap-3 rounded-md border-2 px-6 py-3"
              style={{
                borderColor: `color-mix(in oklab, ${DIRECTION_STYLE[verdict.direction].color} 55%, transparent)`,
                background: `color-mix(in oklab, ${DIRECTION_STYLE[verdict.direction].color} 6%, transparent)`,
                color: DIRECTION_STYLE[verdict.direction].color,
              }}
            >
              <span className="text-[20px]">{DIRECTION_STYLE[verdict.direction].icon}</span>
              <span className="font-display text-3xl tracking-[0.14em]">
                {DIRECTION_STYLE[verdict.direction].word}
              </span>
              {verdict.high_conviction && (
                <span className="font-mono text-[9px] font-semibold tracking-[0.3em]">HIGH</span>
              )}
            </div>
          </div>

          {verdict.direction === 'no_call' ? (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-ink-2">
                Honest abstention — {verdict.reason}. The swarm does not force a number it
                cannot ground.
              </p>
              <div className="flex items-center gap-2 border-y border-hairline py-2">
                <span className="font-mono text-[10px] tracking-[0.14em] text-ink-3">
                  VOTING LENSES
                </span>
                <span className="tnum text-[15px] font-semibold text-ink">
                  N={verdict.voting_lenses}
                </span>
                <span className="text-[12px] text-ink-3">· quorum needs 2</span>
              </div>
            </div>
          ) : (
            <>
              <AggregateAxis value={verdict.aggregate_stance ?? 0} />
              {/* Conviction is NEVER shown without N and dissent */}
              <div
                className="grid grid-cols-3 overflow-hidden rounded-lg border border-hairline"
                style={{ gap: '1px', background: 'var(--color-hairline)' }}
              >
                <StatCell label="CONVICTION" value={(verdict.conviction ?? 0).toFixed(2)} />
                <StatCell label="LENSES" value={`N=${verdict.voting_lenses}`} />
                <StatCell
                  label="DISSENT"
                  value={(verdict.dissent ?? '—').toUpperCase()}
                  color={DISSENT_COLOR[verdict.dissent ?? '']}
                />
              </div>
            </>
          )}

          <div>
            <SectionTag>WHAT WOULD CHANGE OUR MIND</SectionTag>
            {landed.length > 0 ? (
              <div className="mt-2 flex flex-col gap-2.5">
                {landed.map(({ lens, critique }, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span
                      className="mt-[1px] shrink-0 rounded-[3px] px-1.5 py-[3px] font-mono text-[8px] tracking-[0.08em]"
                      style={{
                        color: AGENT_COLOR[lens],
                        background: `color-mix(in oklab, ${AGENT_COLOR[lens]} 14%, transparent)`,
                      }}
                    >
                      {LENS_LABEL[lens]}
                    </span>
                    <span className="text-[12.5px] leading-snug text-ink-2">{critique}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-ink-3">no attacks landed this run</p>
            )}
          </div>

          <OutcomeReveal ticker={ticker} asOf={asOf} />
        </div>
      )}
    </aside>
  )
}

/** The aggregate stance as a BEAR ◂—▸ BULL axis: a marker riding a polarity
 *  gradient, positioned by mapping stance [-1,+1] onto [0%,100%] (0 at center). */
function AggregateAxis({ value }: { value: number }) {
  const pos = 50 + Math.max(-1, Math.min(1, value)) * 50
  const color = poleColor(value)
  return (
    <div>
      <div className="mb-2 flex justify-between font-mono text-[9px] tracking-[0.14em]">
        <span className="text-bear/80">◂ BEAR</span>
        <span className="text-ink-3">aggregate</span>
        <span className="text-bull/85">BULL ▸</span>
      </div>
      <div
        className="relative h-1.5 rounded-full"
        style={{
          background:
            'linear-gradient(90deg, color-mix(in oklab, var(--color-bear) 35%, transparent), rgba(255,255,255,.08) 50%, color-mix(in oklab, var(--color-bull) 35%, transparent))',
        }}
      >
        <span className="absolute -top-0.5 -bottom-0.5 left-1/2 w-px bg-ink-3/40" />
        <span
          className="meter-fill absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{
            left: `${pos}%`,
            background: color,
            borderColor: '#0b0e0c',
            boxShadow: `0 0 10px color-mix(in oklab, ${color} 70%, transparent)`,
          }}
        />
      </div>
      <div className="tnum mt-2 text-right font-mono text-[13px] font-semibold" style={{ color }}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </div>
    </div>
  )
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-surface px-2 py-3 text-center">
      <div className="mb-1.5 font-mono text-[8.5px] tracking-[0.12em] text-ink-3">{label}</div>
      <div className="tnum font-mono text-[19px] font-semibold" style={{ color: color ?? 'var(--color-ink)' }}>
        {value}
      </div>
    </div>
  )
}

/** Absent from the DOM until requested, and requestable only after the verdict.
 *  Before reveal it reads as a sealed envelope; after, the held-out truth. */
function OutcomeReveal({ ticker, asOf }: { ticker: string; asOf: string }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (outcome) {
    const prices = outcome.prices_after
    if (prices.length === 0) {
      return <p className="text-[13px] text-ink-3">outcome window has no trading days yet</p>
    }
    const first = prices[0]
    const last = prices[prices.length - 1]
    const change = (last.close / first.close - 1) * 100
    const up = change >= 0
    const color = up ? 'var(--color-bull)' : 'var(--color-bear)'
    return (
      <div
        className="card-in rounded-lg border p-4"
        style={{
          borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
          background: `linear-gradient(180deg, color-mix(in oklab, ${color} 6%, transparent), transparent)`,
        }}
      >
        <div className="mb-3 flex items-center gap-2 font-mono text-[9.5px] tracking-[0.14em] text-ink-3">
          <span style={{ color: SEALED }}>⬗ UNSEALED</span>
          <span className="text-ink-3/50">·</span>
          <span>WHAT ACTUALLY HAPPENED</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="text-[22px]" style={{ color }}>{up ? '▲' : '▼'}</span>
          <span className="tnum font-mono text-[40px] font-semibold leading-none" style={{ color }}>
            {up ? '+' : ''}{change.toFixed(1)}%
          </span>
        </div>
        <div className="mt-3 font-mono text-[11px] leading-relaxed text-ink-3">
          {first.date} close {first.close.toFixed(2)} → {last.date} close {last.close.toFixed(2)}
        </div>
        <div className="font-mono text-[10px] text-ink-3">
          {prices.length} sessions after as-of
        </div>
      </div>
    )
  }

  return (
    <div
      className="rounded-lg border border-dashed px-4 py-4 text-center"
      style={{
        borderColor: `color-mix(in oklab, ${SEALED} 40%, transparent)`,
        background: `color-mix(in oklab, ${SEALED} 3%, transparent)`,
      }}
    >
      <div className="text-[22px]" style={{ color: SEALED }}>⬗</div>
      <div className="mt-1 font-mono text-[10px] tracking-[0.14em]" style={{ color: SEALED }}>
        OUTCOME SEALED
      </div>
      <div className="mt-1 font-mono text-[10px] text-ink-3">
        held outside agent-visible state for the entire run
      </div>
      <button
        className="mt-3 w-full cursor-pointer rounded-[4px] border border-hairline bg-raised px-3 py-2 text-[12px] font-semibold tracking-[0.18em] text-ink-2 transition-colors hover:border-judge hover:text-judge"
        onClick={() =>
          fetchOutcome(ticker, asOf).then(setOutcome, (e) => setError(String(e.message ?? e)))
        }
      >
        ▣ REVEAL THE OUTCOME
      </button>
      {error && <p className="mt-2 text-[12px] text-bear">{error}</p>}
    </div>
  )
}
