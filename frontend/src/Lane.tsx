/** One specialist's column: thesis → attacks on it → rebuttal → adjudication. */

import {
  AGENT_COLOR,
  AgentChip,
  EvidenceLedger,
  SectionTag,
  StanceMeter,
  ValidationBadge,
} from './components'
import type { LaneState } from './reducer'
import type { Specialist } from './types'

export function Lane({ agent, lane }: { agent: Specialist; lane: LaneState }) {
  return (
    <section
      className="flex min-w-0 flex-col gap-3 border-t-2 bg-surface p-3"
      style={{ borderTopColor: AGENT_COLOR[agent] }}
    >
      <header className="flex items-center justify-between gap-2">
        <AgentChip agent={agent} thinking={lane.status === 'thinking'} />
        <ValidationBadge grounding={lane.grounding} />
      </header>

      {lane.status === 'idle' && !lane.thesis && (
        <p className="text-[13px] text-ink-3">awaiting the floor…</p>
      )}
      {lane.status === 'thinking' && !lane.thesis && (
        <p className="text-[13px] text-ink-3">
          researching<span className="thinking-dot">▊</span>
        </p>
      )}

      {lane.thesis && (
        <div className="card-in">
          <SectionTag>THESIS</SectionTag>
          <StanceMeter value={lane.thesis.stance} label="initial" />
          <p className="mt-1.5 text-[14px] text-ink">{lane.thesis.summary}</p>
          <div className="mt-2.5">
            <div className="mb-1.5 text-[11px] tracking-[0.22em] text-ink-3">
              EVIDENCE LEDGER
            </div>
            <EvidenceLedger evidence={lane.thesis.evidence} emptyLabel="no evidence cited" />
          </div>
        </div>
      )}

      {lane.attacks.map((attack, i) => (
        <div key={i} className="card-in border-l-2 border-redteam bg-raised p-2">
          <div className="flex items-baseline justify-between">
            <SectionTag color="var(--color-redteam)">
              {`◢ ATTACK · ${attack.kind.toUpperCase()}`}
            </SectionTag>
          </div>
          <p className="text-[13px] text-ink-2">{attack.critique}</p>
          {attack.counter_evidence.length > 0 && (
            <div className="mt-1.5">
              <EvidenceLedger evidence={attack.counter_evidence} />
            </div>
          )}
        </div>
      ))}

      {lane.toolActivity.map((t, i) => (
        <p key={i} className="card-in text-[12px] text-ink-3">
          ⚙ {t.tool}
          {t.type === 'tool_call' ? `(${JSON.stringify(t.args)})` : ' → result received'}
        </p>
      ))}

      {lane.rebuttal && (
        <div className="card-in">
          <SectionTag>REBUTTAL — proposed, not final</SectionTag>
          <StanceMeter value={lane.rebuttal.proposed_stance} label="proposed" />
          <p className="mt-1.5 text-[13px] text-ink-2">{lane.rebuttal.response}</p>
        </div>
      )}

      {lane.adjudication && (
        <div className="card-in border-t border-hairline pt-2">
          <SectionTag color="var(--color-judge)">JUDGE ADJUDICATES</SectionTag>
          <StanceMeter value={lane.adjudication.adjudicated_stance} label="final" />
          {lane.adjudication.attacks_landed.length > 0 ? (
            <p className="mt-1.5 text-[13px] text-ink-3">
              landed: {lane.adjudication.attacks_landed.join(' · ')}
            </p>
          ) : (
            <p className="mt-1.5 text-[13px] text-ink-3">no attacks landed</p>
          )}
          {lane.adjudication.rationale && (
            <p className="mt-1 text-[13px] italic text-ink-3">{lane.adjudication.rationale}</p>
          )}
        </div>
      )}
    </section>
  )
}
