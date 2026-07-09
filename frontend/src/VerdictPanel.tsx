/** Shared verdict pieces — the stamp, the aggregate BEAR↔BULL axis, and the
 *  sealed → unsealed Outcome reveal. Imported by the full-width VerdictFinale. */

import { poleColor } from './components'
import type { Outcome, VerdictEvent } from './types'

export const DIRECTION_STYLE: Record<string, { word: string; color: string; icon: string }> = {
  bull: { word: 'BULL', color: 'var(--color-bull)', icon: '▲' },
  bear: { word: 'BEAR', color: 'var(--color-bear)', icon: '▼' },
  neutral: { word: 'NEUTRAL', color: 'var(--color-neutralpole)', icon: '◈' },
  no_call: { word: 'NO CALL', color: 'var(--color-ink-3)', icon: '∅' },
}

const SEALED = 'var(--color-neutralpole)'

/** The rubber-stamp verdict word. `variant` scales it up for the finale. */
export function VerdictStamp({ verdict, variant = 'rail' }: { verdict: VerdictEvent; variant?: 'rail' | 'finale' }) {
  const d = DIRECTION_STYLE[verdict.direction]
  const finale = variant === 'finale'
  return (
    <div
      className="stamp flex items-center rounded-[12px] border-2"
      style={{
        gap: finale ? 18 : 12,
        padding: finale ? '16px 34px' : '11px 22px',
        borderColor: `color-mix(in oklab, ${d.color} 55%, transparent)`,
        background: `color-mix(in oklab, ${d.color} 7%, transparent)`,
        color: d.color,
        boxShadow: finale ? `0 20px 60px -30px ${d.color}` : undefined,
      }}
    >
      <span style={{ fontSize: finale ? 30 : 20 }}>{d.icon}</span>
      <span className="font-display font-medium leading-none" style={{ fontSize: finale ? 52 : 29, letterSpacing: '0.09em' }}>
        {d.word}
      </span>
      {verdict.high_conviction && (
        <span className="font-mono font-semibold" style={{ fontSize: finale ? 10 : 9, letterSpacing: '0.3em' }}>HIGH</span>
      )}
    </div>
  )
}

/** The aggregate stance as a BEAR ◂—▸ BULL axis: a marker riding a polarity
 *  gradient, positioned by mapping stance [-1,+1] onto [0%,100%] (0 at center). */
export function AggregateAxis({ value, variant = 'rail', n }: { value: number; variant?: 'rail' | 'finale'; n?: number }) {
  const pos = 50 + Math.max(-1, Math.min(1, value)) * 50
  const color = poleColor(value)
  const finale = variant === 'finale'
  return (
    <div>
      <div className="mb-2 flex justify-between font-mono text-[9.5px] tracking-[0.16em]">
        <span className="text-bear">◂ BEAR</span>
        <span className="text-ink-3">{finale ? `aggregate stance · N=${n}` : 'aggregate'}</span>
        <span className="text-bull">BULL ▸</span>
      </div>
      <div
        className={`relative rounded-full ${finale ? 'h-2' : 'h-1.5'}`}
        style={{
          background:
            'linear-gradient(90deg, color-mix(in oklab, var(--color-bear) 42%, transparent), rgba(255,255,255,.08) 50%, color-mix(in oklab, var(--color-bull) 42%, transparent))',
        }}
      >
        <span className="absolute -top-1 -bottom-1 left-1/2 w-px bg-ink-3/40" />
        <span
          className={`meter-fill absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${finale ? 'h-[17px] w-[17px] border-[3px]' : 'h-3 w-3 border-2'}`}
          style={{ left: `${pos}%`, background: color, borderColor: finale ? '#14161b' : '#17191f', boxShadow: `0 0 10px color-mix(in oklab, ${color} 70%, transparent)` }}
        />
      </div>
      <div
        className={`tnum font-mono font-semibold ${finale ? 'mt-2.5 text-center text-[22px]' : 'mt-2 text-right text-[13px]'}`}
        style={{ color }}
      >
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </div>
    </div>
  )
}

/** Absent from the DOM until requested, and requestable only after the verdict.
 *  Before reveal it reads as a sealed envelope; after, the held-out truth.
 *  State lives in App so the rail and the finale reveal together. */
export function OutcomeReveal({ outcome, onReveal, error, variant = 'rail', reality }: {
  outcome: Outcome | null
  onReveal: () => void
  error: string | null
  variant?: 'rail' | 'finale'
  /** the swarm's call scored against what actually happened — the third column */
  reality?: { word: string; ok: boolean }
}) {
  const finale = variant === 'finale'

  if (outcome) {
    const prices = outcome.prices_after
    if (prices.length === 0) {
      return <p className="text-center text-[13px] text-ink-3">outcome window has no trading days yet</p>
    }
    const first = prices[0]
    const last = prices[prices.length - 1]
    const change = (last.close / first.close - 1) * 100
    const up = change >= 0
    const color = up ? 'var(--color-bull)' : 'var(--color-bear)'
    return (
      <div
        className="card-in rounded-[14px] border px-10 py-8 text-center"
        style={{
          borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
          background: `linear-gradient(180deg, color-mix(in oklab, ${color} 6%, transparent), transparent)`,
        }}
      >
        <div className="mb-5 flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.14em] text-ink-3">
          <span style={{ color: SEALED }}>◈ UNSEALED</span>
          <span className="text-ink-3/50">·</span>
          <span>WHAT ACTUALLY HAPPENED</span>
        </div>
        <div className="flex flex-wrap items-start justify-center gap-x-11 gap-y-6 text-left">
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-3">{prices.length}-session return</div>
            <div className="tnum font-display leading-none" style={{ color, fontSize: 34 }}>
              {up ? '+' : ''}{change.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-3">Window</div>
            <div className="mt-2 font-mono text-[13px] leading-relaxed text-ink-2">{first.date} → {last.date}</div>
            <div className="font-mono text-[11px] text-ink-3">{first.close.toFixed(2)} → {last.close.toFixed(2)}</div>
          </div>
          {reality && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-3">Verdict vs. reality</div>
              <div className="font-display leading-none" style={{ color: reality.ok ? 'var(--color-bull)' : 'var(--color-bear)', fontSize: 34 }}>
                {reality.word}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col items-center rounded-[12px] border border-dashed text-center ${finale ? 'flex-1 justify-center p-6' : 'p-4'}`}
      style={{ borderColor: `color-mix(in oklab, ${SEALED} 40%, transparent)`, background: `color-mix(in oklab, ${SEALED} 3%, transparent)` }}
    >
      <div style={{ color: SEALED, fontSize: finale ? 30 : 22 }}>◈</div>
      <div className="mt-1.5 font-mono text-[10.5px] tracking-[0.16em]" style={{ color: SEALED }}>OUTCOME SEALED</div>
      <div className="mt-1.5 font-mono text-[10px] leading-relaxed text-ink-3">
        held outside agent-visible state for the entire run
      </div>
      <button
        className="mt-4 cursor-pointer rounded-[9px] border px-5 py-2.5 font-mono text-[12px] font-semibold tracking-[0.14em] transition-colors"
        style={{ borderColor: `color-mix(in oklab, ${SEALED} 40%, transparent)`, background: `color-mix(in oklab, ${SEALED} 8%, transparent)`, color: SEALED }}
        onClick={onReveal}
      >
        ▣ REVEAL THE OUTCOME
      </button>
      {error && <p className="mt-2 text-[12px] text-bear">{error}</p>}
    </div>
  )
}
