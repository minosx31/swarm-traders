/** The finale, matched to the Claude Design mockup: a centered "VERIFIED"
 *  card — seal, Computed Verdict stamp, ticker · as-of, a circular conviction-ring
 *  gauge with its derivation line, the aggregate BEAR↔BULL axis, and a stats
 *  footer (theses surviving / attacks landed / dissent / model) — followed by the
 *  held-out Outcome unsealed below. Reuses the shared stamp/axis/outcome pieces. */

import type { DebateState } from './reducer'
import { SPECIALISTS, type Outcome } from './types'
import { AggregateAxis, DIRECTION_STYLE, OutcomeReveal, VerdictStamp } from './VerdictPanel'

/** How the conviction score was arrived at — the line beside the gauge ring. */
const CONVICTION_LINE: Record<string, string> = {
  bear: 'Weighted from the theses that survived adversarial review — the bear case held under the red-team’s challenges.',
  bull: 'Weighted from the theses that held up under adversarial pressure across the lenses.',
  neutral: 'The lenses split and no side cleared the bar — conviction stays low.',
  no_call: 'Too little grounded evidence survived to justify a call this run.',
}

const DISSENT_COLOR: Record<string, string> = {
  low: 'var(--color-judge)',
  med: 'var(--color-neutralpole)',
  high: 'var(--color-bear)',
}

const RING_CIRCUMFERENCE = 2 * Math.PI * 52 // r=52 → ~326.7

/** The circular conviction gauge: a ring filled clockwise to `conviction`, with
 *  the 0–100 score in the middle. Tinted with the verdict's direction color. */
function ConvictionRing({ conviction, color }: { conviction: number; color: string }) {
  const pct = Math.max(0, Math.min(1, conviction))
  return (
    <div className="relative h-[120px] w-[120px] shrink-0">
      <svg width={120} height={120} viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={60} cy={60} r={52} fill="none" stroke="var(--color-raised)" strokeWidth={10} />
        <circle
          cx={60} cy={60} r={52} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-display text-[30px] text-ink">
        {Math.round(pct * 100)}
      </div>
    </div>
  )
}

export function VerdictFinale({ state, outcome, onReveal, outcomeError, ticker, asOf, model }: {
  state: DebateState
  outcome: Outcome | null
  onReveal: () => void
  outcomeError: string | null
  ticker: string
  asOf: string
  model?: string
}) {
  const verdict = state.verdict
  if (!verdict) return null
  const d = DIRECTION_STYLE[verdict.direction]
  const scored = verdict.direction === 'bull' || verdict.direction === 'bear'
  const showGauge = verdict.conviction != null && verdict.direction !== 'no_call'

  const attackCount = SPECIALISTS.reduce((n, s) => n + state.lanes[s].attacks.length, 0)
  const landedCount = SPECIALISTS.filter((s) => (state.lanes[s].adjudication?.attacks_landed?.length ?? 0) > 0).length

  // call-vs-reality: only meaningful once the outcome is unsealed and the swarm took a
  // side — rendered as the third column inside the unsealed panel
  let reality: { word: string; ok: boolean } | undefined
  if (outcome && outcome.prices_after.length > 0 && scored) {
    const p = outcome.prices_after
    const change = p[p.length - 1].close / p[0].close - 1
    const ok = (verdict.direction === 'bull' && change > 0) || (verdict.direction === 'bear' && change < 0)
    reality = { ok, word: ok ? 'Aligned' : 'Missed' }
  }

  return (
    <div className="mt-[52px]">
      {/* ── the verdict card ── */}
      <div
        className="relative overflow-hidden rounded-2xl px-8 py-12 text-center sm:px-10"
        style={{
          border: `1px solid color-mix(in oklab, ${d.color} 40%, var(--color-hairline))`,
          background: `radial-gradient(ellipse at top, color-mix(in oklab, ${d.color} 11%, transparent), var(--color-surface) 62%)`,
        }}
      >
        <div
          className="stamp mx-auto mb-5 flex h-[62px] w-[62px] items-center justify-center rounded-full font-display text-[10px] leading-[1.2] tracking-[0.06em]"
          style={{ border: `2px solid ${d.color}`, color: d.color }}
        >
          VERIFIED
        </div>

        <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.28em] text-ink-3">Computed Verdict</div>

        <div className="mb-2 flex justify-center">
          <VerdictStamp verdict={verdict} variant="finale" />
        </div>

        <div className="mb-[30px] font-mono text-[14px] text-ink-3">{ticker} · as of {asOf}</div>

        {showGauge && (
          <div className="mb-7 flex flex-wrap items-center justify-center gap-[30px]">
            <ConvictionRing conviction={verdict.conviction ?? 0} color={d.color} />
            <div className="max-w-[300px] text-left">
              <div className="mb-[7px] text-[11px] uppercase tracking-[0.1em] text-ink-3">Conviction score</div>
              <div className="text-[13.5px] leading-relaxed text-ink-2">{CONVICTION_LINE[verdict.direction] ?? ''}</div>
            </div>
          </div>
        )}

        {scored && (
          <div className="mx-auto mb-[26px] max-w-[520px]">
            <AggregateAxis value={verdict.aggregate_stance ?? 0} variant="finale" n={verdict.voting_lenses} />
          </div>
        )}

        {!scored && !showGauge && (
          <p className="mx-auto mb-[26px] max-w-[520px] text-[13.5px] leading-relaxed text-ink-2">
            {CONVICTION_LINE[verdict.direction] ?? ''}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 border-t border-hairline pt-[22px] font-mono text-[12px] text-ink-3">
          <span>Theses surviving: <b className="font-semibold text-ink-2">{verdict.voting_lenses} / {SPECIALISTS.length}</b></span>
          <span>Attacks landed: <b className="font-semibold text-ink-2">{landedCount} / {attackCount}</b></span>
          {verdict.dissent && (
            <span>Dissent: <b className="font-semibold" style={{ color: DISSENT_COLOR[verdict.dissent] }}>{verdict.dissent.toUpperCase()}</b></span>
          )}
          {model && <span>Model: <b className="font-semibold text-ink-2">{model}</b></span>}
        </div>
      </div>

      {/* ── the held-out outcome, unsealed below ── */}
      <div className="mt-[22px]">
        <OutcomeReveal outcome={outcome} onReveal={onReveal} error={outcomeError} variant="finale" reality={reality} />
      </div>
    </div>
  )
}
