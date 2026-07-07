/** The sticky verdict rail: verdict stamp, aggregate BEAR↔BULL axis, conviction +
 *  N + dissent, what-would-change-our-mind, then the sealed → unsealed Outcome.
 *  Its stamp / axis / stat-grid / landed-list / outcome pieces are exported and
 *  reused by the full-width VerdictFinale, so the two never drift. */

import { AGENT_COLOR, AGENT_NAME, poleColor, SectionTag } from './components'
import type { DebateState } from './reducer'
import { SPECIALISTS, type Outcome, type Specialist, type VerdictEvent } from './types'

export const DIRECTION_STYLE: Record<string, { word: string; color: string; icon: string }> = {
  bull: { word: 'BULL', color: 'var(--color-bull)', icon: '▲' },
  bear: { word: 'BEAR', color: 'var(--color-bear)', icon: '▼' },
  neutral: { word: 'NEUTRAL', color: 'var(--color-neutralpole)', icon: '◈' },
  no_call: { word: 'NO CALL', color: 'var(--color-ink-3)', icon: '∅' },
}

const LENS_LABEL: Record<Specialist, string> = {
  fundamentals: 'FUND',
  sentiment: 'SENT',
  technicals: 'TECH',
}

const DISSENT_COLOR: Record<string, string> = {
  low: 'var(--color-judge)',
  med: 'var(--color-neutralpole)',
  high: 'var(--color-bear)',
}

const SEALED = 'var(--color-neutralpole)'

/** Which lenses conceded an attack, and what kind — the "what would change our
 *  mind" material, derived straight from each specialist's judge ruling. */
export function landedFromState(state: DebateState): { lens: Specialist; kind: string }[] {
  return SPECIALISTS.flatMap((s) =>
    (state.lanes[s].adjudication?.attacks_landed ?? []).map((kind) => ({ lens: s, kind })),
  )
}

export function VerdictPanel({ state, outcome, onReveal, outcomeError }: {
  state: DebateState
  outcome: Outcome | null
  onReveal: () => void
  outcomeError: string | null
}) {
  const verdict = state.verdict

  return (
    <aside
      className="sticky top-5 flex w-full flex-1 basis-[320px] max-w-[380px] min-w-[300px] flex-col gap-[18px] self-start rounded-2xl border border-hairline p-5"
      style={{ background: 'linear-gradient(180deg,#1b1e25,#17191f)' }}
    >
      <div className="font-mono text-[10.5px] tracking-[0.24em] text-ink-3">VERDICT</div>

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
        <div className="card-in flex flex-col gap-[18px]">
          <div className="flex justify-center py-1">
            <VerdictStamp verdict={verdict} />
          </div>

          {verdict.direction === 'no_call' ? (
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-ink-2">
                Honest abstention — {verdict.reason}. The swarm does not force a number it cannot ground.
              </p>
              <div className="flex items-center gap-2 border-y border-hairline py-2">
                <span className="font-mono text-[10px] tracking-[0.14em] text-ink-3">VOTING LENSES</span>
                <span className="tnum font-mono text-[15px] font-semibold text-ink">N={verdict.voting_lenses}</span>
                <span className="text-[12px] text-ink-3">· quorum needs 2</span>
              </div>
            </div>
          ) : (
            <>
              <AggregateAxis value={verdict.aggregate_stance ?? 0} />
              <StatGrid verdict={verdict} />
            </>
          )}

          <div>
            <SectionTag>WHAT WOULD CHANGE OUR MIND</SectionTag>
            <div className="mt-2.5">
              <LandedList landed={landedFromState(state)} />
            </div>
          </div>

          <OutcomeReveal outcome={outcome} onReveal={onReveal} error={outcomeError} variant="rail" />
        </div>
      )}
    </aside>
  )
}

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

export function StatGrid({ verdict, variant = 'rail' }: { verdict: VerdictEvent; variant?: 'rail' | 'finale' }) {
  const pad = variant === 'finale' ? 'px-1.5 py-4' : 'px-1 py-[11px]'
  const size = variant === 'finale' ? 'text-[24px]' : 'text-[18px]'
  return (
    <div className="grid grid-cols-3 overflow-hidden rounded-[10px] border border-hairline" style={{ gap: '1px', background: 'var(--color-hairline)' }}>
      <StatCell label="CONVICTION" value={(verdict.conviction ?? 0).toFixed(2)} pad={pad} size={size} />
      <StatCell label="LENSES" value={`N=${verdict.voting_lenses}`} pad={pad} size={size} />
      <StatCell label="DISSENT" value={(verdict.dissent ?? '—').toUpperCase()} color={DISSENT_COLOR[verdict.dissent ?? '']} pad={pad} size={size} />
    </div>
  )
}

function StatCell({ label, value, color, pad, size }: { label: string; value: string; color?: string; pad: string; size: string }) {
  return (
    <div className={`bg-surface text-center ${pad}`}>
      <div className="mb-1.5 font-mono text-[8.5px] tracking-[0.1em] text-ink-3">{label}</div>
      <div className={`tnum font-mono font-semibold ${size}`} style={{ color: color ?? 'var(--color-ink)' }}>{value}</div>
    </div>
  )
}

export function LandedList({ landed }: { landed: { lens: Specialist; kind: string }[] }) {
  if (landed.length === 0) return <p className="text-[12.5px] text-ink-3">No attacks landed this run.</p>
  return (
    <div className="flex flex-col gap-2.5">
      {landed.map(({ lens, kind }, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <span
            className="mt-px shrink-0 rounded-[4px] px-1.5 py-[3px] font-mono text-[8px] tracking-[0.06em]"
            style={{ color: AGENT_COLOR[lens], background: `color-mix(in oklab, ${AGENT_COLOR[lens]} 14%, transparent)` }}
          >
            {LENS_LABEL[lens]}
          </span>
          <span className="text-[12.5px] leading-snug text-ink-2">
            The {AGENT_NAME[lens].toLowerCase()} lens conceded a {kind} flaw — reversing this would lift the aggregate.
          </span>
        </div>
      ))}
    </div>
  )
}

/** Absent from the DOM until requested, and requestable only after the verdict.
 *  Before reveal it reads as a sealed envelope; after, the held-out truth.
 *  State lives in App so the rail and the finale reveal together. */
export function OutcomeReveal({ outcome, onReveal, error, variant = 'rail' }: {
  outcome: Outcome | null
  onReveal: () => void
  error: string | null
  variant?: 'rail' | 'finale'
}) {
  const finale = variant === 'finale'

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
        className={`card-in rounded-[12px] border ${finale ? 'flex flex-1 flex-col justify-center p-5' : 'p-[15px]'}`}
        style={{
          borderColor: `color-mix(in oklab, ${color} 30%, transparent)`,
          background: `linear-gradient(180deg, color-mix(in oklab, ${color} 6%, transparent), transparent)`,
        }}
      >
        <div className="mb-3 flex items-center gap-2 font-mono text-[9.5px] tracking-[0.14em] text-ink-3">
          <span style={{ color: SEALED }}>◈ UNSEALED</span>
          <span className="text-ink-3/50">·</span>
          <span>WHAT ACTUALLY HAPPENED</span>
        </div>
        <div className="flex items-baseline gap-3">
          <span style={{ color, fontSize: finale ? 26 : 20 }}>{up ? '▲' : '▼'}</span>
          <span className="tnum font-mono font-semibold leading-none" style={{ color, fontSize: finale ? 52 : 38 }}>
            {up ? '+' : ''}{change.toFixed(1)}%
          </span>
        </div>
        <div className="mt-3 font-mono text-[11px] leading-relaxed text-ink-3">
          {first.date} close {first.close.toFixed(2)} → {last.date} close {last.close.toFixed(2)}
        </div>
        <div className="font-mono text-[10px] text-ink-3">{prices.length} sessions after as-of</div>
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
