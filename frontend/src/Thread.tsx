/** One specialist's debate thread: the thesis stated as a card, with its
 *  challenge — red-team attacks → the specialist's rebuttal → the judge's
 *  ruling — nested directly underneath as a connected timeline. */

import type { ReactNode } from 'react'
import {
  AGENT_NAME,
  AGENT_ROLE,
  Avatar,
  EvidenceList,
  MiniStance,
  Pill,
} from './components'
import type { LaneState } from './reducer'
import type { AgentName, SnapshotManifest, Specialist } from './types'

const REDTEAM = 'var(--color-redteam)'
const JUDGE = 'var(--color-judge)'
const NEUTRAL = 'var(--color-neutralpole)'

type ChallengeEntry = {
  agent: AgentName
  pill: ReactNode
  dot: { color?: string; dashed?: string }
  stance?: number
  italic?: boolean
  body: ReactNode
  landed?: { text: string; won: boolean }
}

export function Thread({ agent, lane, manifest }: { agent: Specialist; lane: LaneState; manifest?: SnapshotManifest | null }) {
  const abstained = lane.grounding ? !lane.grounding.gated_in : false

  // researching, no thesis on the floor yet — a light live placeholder
  if (!lane.thesis) {
    return (
      <div className="card-in rounded-2xl border border-hairline bg-surface p-4">
        <div className="flex items-center gap-3">
          <Avatar agent={agent} />
          <div>
            <div className="text-[13.5px] font-semibold text-ink">{AGENT_NAME[agent]}</div>
            <div className="text-[11.5px] text-ink-3">{AGENT_ROLE[agent]}</div>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-ink-3">
          researching<span className="thinking-dot">▊</span>
        </p>
      </div>
    )
  }

  const challenge = buildChallenge(agent, lane)

  return (
    <div className="card-in rounded-2xl border border-hairline bg-surface p-[16px_18px]">
      {/* thesis header */}
      <div className="flex items-start gap-3">
        <Avatar agent={agent} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-ink">{AGENT_NAME[agent]}</span>
            <span className="text-[11.5px] text-ink-3">{AGENT_ROLE[agent]}</span>
            <MiniStance value={lane.thesis.stance} />
          </div>
          <div className="mt-[7px] flex flex-wrap items-center gap-2">
            <Pill color="var(--color-fundamentals)">THESIS · INITIAL</Pill>
            {abstained && (
              <span className="rounded-[5px] border border-hairline px-2 py-[3px] font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink-3">
                ABSTAINED · NO VOTE
              </span>
            )}
          </div>
        </div>
      </div>

      <p className="mt-3 font-display text-[16.5px] leading-relaxed text-ink">{lane.thesis.summary}</p>

      {lane.thesis.evidence.length > 0 && (
        <div className="mt-[13px] border-t border-hairline pt-[11px]">
          <div className="mb-2 font-mono text-[9.5px] tracking-[0.18em] text-ink-3">
            EVIDENCE · TAP A CITATION TO VERIFY
          </div>
          <EvidenceList evidence={lane.thesis.evidence} manifest={manifest ?? undefined} />
        </div>
      )}

      {challenge.length > 0 && (
        <div className="mt-[14px] border-t border-dashed border-hairline pt-[13px]">
          <div className="mb-3 font-mono text-[9.5px] tracking-[0.18em] text-ink-2">⚔ THE CHALLENGE</div>
          <div className="relative">
            <span className="absolute bottom-[14px] left-[5px] top-[5px] w-px bg-hairline" aria-hidden />
            <div className="flex flex-col gap-3.5">
              {challenge.map((e, i) => (
                <div key={i} className="card-in relative pl-[22px]">
                  <span
                    className="absolute left-0 top-1 h-[11px] w-[11px] rounded-[3px]"
                    style={e.dot.dashed ? { border: `1px dashed ${e.dot.dashed}` } : { background: e.dot.color }}
                    aria-hidden
                  />
                  <div className="rounded-xl border border-hairline p-[11px_13px]" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Avatar agent={e.agent} size={26} />
                      {e.pill}
                      {e.stance != null && <MiniStance value={e.stance} />}
                    </div>
                    <p className={`mt-[9px] font-display text-[14.5px] leading-relaxed ${e.italic ? 'italic text-ink-2' : 'text-ink'}`}>
                      {e.body}
                    </p>
                    {e.landed && (
                      <p className="mt-[9px] font-mono text-[11px]" style={{ color: e.landed.won ? REDTEAM : 'var(--color-ink-3)' }}>
                        {e.landed.text}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function buildChallenge(agent: Specialist, lane: LaneState): ChallengeEntry[] {
  const entries: ChallengeEntry[] = []

  lane.attacks.forEach((attack) => {
    entries.push({
      agent: 'red_team',
      dot: { color: REDTEAM },
      pill: <Pill color={REDTEAM}>RED-TEAM ATTACK · {attack.kind.toUpperCase()}</Pill>,
      body: attack.critique,
    })
  })

  if (lane.rebuttal) {
    entries.push({
      agent,
      dot: { dashed: NEUTRAL },
      pill: <Pill color={NEUTRAL} dashed>REBUTTAL · PROPOSED</Pill>,
      stance: lane.rebuttal.proposed_stance,
      italic: true,
      body: lane.rebuttal.response,
    })
  }

  if (lane.adjudication) {
    const adj = lane.adjudication
    const won = adj.attacks_landed.length > 0
    entries.push({
      agent: 'judge',
      dot: { color: JUDGE },
      pill: <Pill color={JUDGE}>JUDGE RULING · FINAL</Pill>,
      stance: adj.adjudicated_stance,
      body: adj.rationale ?? '',
      landed: {
        text: won ? `Landed: ${adj.attacks_landed.join(' · ')}` : 'No attacks landed — stance stands.',
        won,
      },
    })
  }

  return entries
}
