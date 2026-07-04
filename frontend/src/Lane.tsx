/** One specialist's column, laid out as a vertical debate timeline:
 *  thesis → attacks on it → rebuttal → adjudication, each a node on a connector. */

import type { ReactNode } from 'react'
import {
  AGENT_COLOR,
  AGENT_LABEL,
  EvidenceLedger,
  MiniStance,
  Pill,
  ValidationBadge,
} from './components'
import type { LaneState } from './reducer'
import type { Specialist } from './types'

const REDTEAM = 'var(--color-redteam)'
const JUDGE = 'var(--color-judge)'
const AMBER = '#d9a441' // "proposed, not yet ruled" — a held, provisional state

type Entry = { node: string; dashed?: boolean; body: ReactNode }

export function Lane({ agent, lane }: { agent: Specialist; lane: LaneState }) {
  const color = AGENT_COLOR[agent]
  const entries: Entry[] = []

  if (lane.thesis) {
    entries.push({
      node: color,
      body: (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Pill color={color}>THESIS · INITIAL</Pill>
            <MiniStance value={lane.thesis.stance} />
          </div>
          <p className="text-[14px] leading-relaxed text-ink">{lane.thesis.summary}</p>
          <div className="mt-3 border-t border-hairline pt-3">
            <div className="mb-2 font-mono text-[9.5px] tracking-[0.18em] text-ink-3">
              EVIDENCE LEDGER
            </div>
            <EvidenceLedger evidence={lane.thesis.evidence} emptyLabel="no evidence cited" />
          </div>
        </>
      ),
    })
  }

  lane.attacks.forEach((attack) => {
    entries.push({
      node: REDTEAM,
      body: (
        <>
          <div className="mb-2">
            <Pill color={REDTEAM}>⚔ RED-TEAM ATTACK · {attack.kind.toUpperCase()}</Pill>
          </div>
          <p className="text-[13.5px] leading-relaxed text-ink-2">{attack.critique}</p>
          {attack.counter_evidence.length > 0 && (
            <div className="mt-2">
              <EvidenceLedger evidence={attack.counter_evidence} />
            </div>
          )}
        </>
      ),
    })
  })

  if (lane.rebuttal) {
    entries.push({
      node: AMBER,
      dashed: true,
      body: (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Pill color={AMBER} dashed>REBUTTAL · PROPOSED</Pill>
            <MiniStance value={lane.rebuttal.proposed_stance} />
          </div>
          <p className="text-[13.5px] italic leading-relaxed text-ink-3">
            {lane.rebuttal.response}
          </p>
        </>
      ),
    })
  }

  if (lane.adjudication) {
    const adj = lane.adjudication
    entries.push({
      node: JUDGE,
      body: (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Pill color={JUDGE}>JUDGE ADJUDICATES · FINAL</Pill>
            <MiniStance value={adj.adjudicated_stance} />
          </div>
          {adj.attacks_landed.length > 0 ? (
            <p className="text-[13px] text-ink-3">landed: {adj.attacks_landed.join(' · ')}</p>
          ) : (
            <p className="text-[13px] text-ink-3">no attacks landed</p>
          )}
          {adj.rationale && (
            <p className="mt-1 text-[13px] italic text-ink-3">{adj.rationale}</p>
          )}
        </>
      ),
    })
  }

  return (
    <section
      className="flex min-w-0 flex-col border-t-2 bg-surface px-5 py-4"
      style={{ borderTopColor: color }}
    >
      <header className="mb-5 flex items-center gap-2.5">
        <span
          className={`h-2.5 w-2.5 rounded-[2px] ${lane.status === 'thinking' ? 'thinking-dot' : ''}`}
          style={{ background: color, boxShadow: `0 0 10px color-mix(in oklab, ${color} 55%, transparent)` }}
        />
        <span className="font-mono text-[13px] font-semibold tracking-[0.12em] text-ink">
          {AGENT_LABEL[agent]}
        </span>
        <span className="ml-auto">
          <ValidationBadge grounding={lane.grounding} />
        </span>
      </header>

      {lane.status === 'idle' && !lane.thesis && (
        <p className="text-[13px] text-ink-3">awaiting the floor…</p>
      )}
      {lane.status === 'thinking' && !lane.thesis && (
        <p className="text-[13px] text-ink-3">
          researching<span className="thinking-dot">▊</span>
        </p>
      )}

      <div className="relative">
        {entries.map((entry, i) => {
          const last = i === entries.length - 1
          return (
            <div key={i} className={`card-in relative pl-6 ${last ? '' : 'pb-5'}`}>
              {!last && (
                <span className="absolute bottom-0 left-[4px] top-4 w-px bg-hairline" aria-hidden />
              )}
              <span
                className="absolute left-0 top-[3px] h-2.5 w-2.5 rounded-[2px]"
                style={entry.dashed ? { border: `1px dashed ${entry.node}` } : { background: entry.node }}
                aria-hidden
              />
              {entry.body}
            </div>
          )
        })}
      </div>

      {lane.toolActivity.map((t, i) => (
        <p key={i} className="card-in mt-2 font-mono text-[11px] text-ink-3">
          ⚙ {t.tool}
          {t.type === 'tool_call' ? `(${JSON.stringify(t.args)})` : ' → result received'}
        </p>
      ))}
    </section>
  )
}
