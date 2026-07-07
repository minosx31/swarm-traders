/** The full-width finale: once the swarm rules, the verdict gets a centered,
 *  dramatic restatement — stamp, aggregate axis, the stat grid + what-would-
 *  change-our-mind, and the held-out Outcome unsealed alongside a call-vs-reality
 *  check. Reuses the rail's stamp/axis/grid/landed/outcome pieces so they can't drift. */

import { SectionTag } from './components'
import type { DebateState } from './reducer'
import type { Outcome } from './types'
import {
  AggregateAxis,
  DIRECTION_STYLE,
  landedFromState,
  LandedList,
  OutcomeReveal,
  StatGrid,
  VerdictStamp,
} from './VerdictPanel'

const FINALE_LINE: Record<string, (n: number) => string> = {
  bear: (n) => `After ${n} events across the lenses, the red-team pass and a judge ruling, the swarm calls the bear case — the drawdown survived every challenge.`,
  bull: (n) => `After ${n} events, the bull case held up under adversarial pressure and the swarm calls it long.`,
  neutral: () => 'The lenses split and no side cleared the bar — the swarm holds neutral.',
  no_call: () => 'Too little grounded evidence survived to justify a call this run.',
}

export function VerdictFinale({ state, outcome, onReveal, outcomeError }: {
  state: DebateState
  outcome: Outcome | null
  onReveal: () => void
  outcomeError: string | null
}) {
  const verdict = state.verdict
  if (!verdict) return null
  const d = DIRECTION_STYLE[verdict.direction]
  const scored = verdict.direction === 'bull' || verdict.direction === 'bear'

  // call-vs-reality: only meaningful once the outcome is unsealed and the swarm
  // actually took a side
  let match: { text: string; ok: boolean } | null = null
  if (outcome && outcome.prices_after.length > 0 && scored) {
    const p = outcome.prices_after
    const change = p[p.length - 1].close / p[0].close - 1
    const ok = (verdict.direction === 'bull' && change > 0) || (verdict.direction === 'bear' && change < 0)
    match = {
      ok,
      text: ok
        ? '✓ THE CALL WAS RIGHT — OUTCOME AGREED WITH THE VERDICT'
        : '✗ THE CALL MISSED — OUTCOME DIVERGED FROM THE VERDICT',
    }
  }

  return (
    <section className="relative overflow-hidden border-t border-hairline" style={{ background: 'linear-gradient(180deg,#171a20,#14161b)' }}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(80% 120% at 50% 0%, color-mix(in oklab, ${d.color} 12%, transparent), transparent 60%)` }}
      />
      <div className="relative mx-auto max-w-[900px] px-[30px] pb-[60px] pt-[52px] text-center">
        <div className="mb-[22px] font-mono text-[10.5px] tracking-[0.34em] text-ink-3">THE SWARM HAS RULED</div>

        <div className="mb-3.5 flex justify-center">
          <VerdictStamp verdict={verdict} variant="finale" />
        </div>

        <p className="mx-auto mb-[34px] max-w-[560px] font-display text-[17px] italic leading-relaxed text-ink-2">
          {(FINALE_LINE[verdict.direction] ?? (() => ''))(state.eventCount)}
        </p>

        {scored && (
          <div className="mx-auto mb-[34px] max-w-[560px]">
            <AggregateAxis value={verdict.aggregate_stance ?? 0} variant="finale" n={verdict.voting_lenses} />
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-3.5 text-left">
          <div className="max-w-[420px] flex-1 basis-[300px]">
            {scored && <StatGrid verdict={verdict} variant="finale" />}
            <div className={`rounded-[12px] border border-hairline bg-surface p-4 ${scored ? 'mt-3.5' : ''}`}>
              <SectionTag>WHAT WOULD CHANGE OUR MIND</SectionTag>
              <div className="mt-3">
                <LandedList landed={landedFromState(state)} />
              </div>
            </div>
          </div>

          <div className="flex max-w-[420px] flex-1 basis-[300px] flex-col gap-3">
            <OutcomeReveal outcome={outcome} onReveal={onReveal} error={outcomeError} variant="finale" />
            {match && (
              <div className="font-mono text-[10px] tracking-[0.06em]" style={{ color: match.ok ? 'var(--color-bull)' : 'var(--color-bear)' }}>
                {match.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
