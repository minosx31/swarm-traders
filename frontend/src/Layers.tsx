/** The four numbered acts of the debate feed (redesign mock, issue #14):
 *  01 Theses → 02 Attacks → 03 Rebuttals → 04 Ruling. Replaces the old
 *  per-specialist Thread grouping — same reducer state, read across all
 *  three lanes at once instead of nested inside one card per specialist.
 *
 *  A layer appears once it has content; its Pending/Running…/Complete badge
 *  is derived from whether a later layer already has content (or the run is
 *  done), matching the mock's `_layer()` helper. Mock-only fields not in the
 *  SSE contract (attack `severity`/`title`, rebuttal confidence deltas) are
 *  not invented — see the per-section notes below for what's substituted. */

import {
  AGENT_NAME,
  AGENT_ROLE,
  Avatar,
  EvidenceList,
  MiniStance,
  poleColor,
} from './components'
import type { DebateState, LaneState } from './reducer'
import { SPECIALISTS, type Specialist, type SnapshotManifest } from './types'

type LayerStatus = 'pending' | 'running' | 'complete'

const STATUS_LABEL: Record<LayerStatus, string> = {
  pending: 'Pending',
  running: 'Running…',
  complete: 'Complete',
}

const STATUS_COLOR: Record<LayerStatus, string> = {
  pending: 'var(--color-ink-3)',
  running: 'var(--color-neutralpole)',
  complete: 'var(--color-judge)',
}

/** 01 judge / 02 redteam / 03 neutralpole / 04 judge — the mock's per-layer chip tint. */
const LAYER_TINT = ['var(--color-judge)', 'var(--color-redteam)', 'var(--color-neutralpole)', 'var(--color-judge)']

function layerStatus(hasContent: boolean, laterHasContent: boolean, done: boolean): LayerStatus {
  if (!hasContent) return 'pending'
  if (laterHasContent || done) return 'complete'
  return 'running'
}

/** Header row: numbered mono chip + uppercase label + hairline rule. */
function LayerHeading({ n, label }: { n: number; label: string }) {
  const tint = LAYER_TINT[n - 1]
  return (
    <div className="mb-[15px] mt-14 flex items-center gap-3 first:mt-0">
      <span
        className="rounded-[5px] border font-mono text-[12px] tracking-[0.08em]"
        style={{ color: tint, borderColor: `color-mix(in oklab, ${tint} 35%, transparent)`, padding: '2px 8px' }}
      >
        {String(n).padStart(2, '0')}
      </span>
      <span className="text-[11.5px] font-semibold uppercase tracking-[0.18em] text-ink-3">{label}</span>
      <span className="h-px flex-1 bg-hairline" />
    </div>
  )
}

/** Card header: italic display title, status badge, right-aligned mono sub. */
function LayerCardHeader({ title, status, sub }: { title: string; status: LayerStatus; sub: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-hairline bg-raised/40 px-5 py-[13px]">
      <div className="flex items-center gap-[11px]">
        <span className="font-display text-[17px] italic text-ink">{title}</span>
        <span
          className="rounded-[5px] px-[9px] py-[3px] font-mono text-[10px] font-semibold tracking-[0.1em]"
          style={{ color: STATUS_COLOR[status], background: `color-mix(in oklab, ${STATUS_COLOR[status]} 14%, transparent)` }}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
      <span className="font-mono text-[11px] text-ink-3">{sub}</span>
    </div>
  )
}

/** The ⚙ tool-call trail for one agent: `⚙ get_financials … / ✓ 0.3s`. Shared by
 *  the specialist research (01), red-team (02) and rebuttal (03) layers — every
 *  place an agent reaches into the cached snapshot via a tool (DEBATE_TOOLS). */
function ToolActivity({ items, label }: { items: LaneState['researchActivity']; label: string }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-hairline bg-page px-[15px] py-3 font-mono text-[11.5px] text-ink-3">
      <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.12em] text-ink-3">{label}</div>
      {items.map((t, i) => (
        <span key={i} className="tnum">
          ⚙ {t.tool}
          {t.type === 'tool_result'
            ? t.duration_s != null ? ` ✓ ${t.duration_s}s` : ' ✓'
            : '…'}
        </span>
      ))}
    </div>
  )
}

export function LayerFeed({ state, manifest }: { state: DebateState; manifest?: SnapshotManifest | null }) {
  const lanes = state.lanes
  const started = SPECIALISTS.filter((s) => lanes[s].status !== 'idle' || lanes[s].thesis)
  const theses = SPECIALISTS.filter((s) => lanes[s].thesis)
  const attackLanes = SPECIALISTS.filter((s) => lanes[s].attacks.length > 0)
  const totalAttacks = SPECIALISTS.reduce((n, s) => n + lanes[s].attacks.length, 0)
  const standDowns = SPECIALISTS.filter((s) => lanes[s].grounding && !lanes[s].grounding!.gated_in && lanes[s].attacks.length === 0)
  const rebuttals = SPECIALISTS.filter((s) => lanes[s].rebuttal)
  const adjudications = SPECIALISTS.filter((s) => lanes[s].adjudication)
  const done = state.phase === 'done'

  const hasL1 = started.length > 0
  const hasL2 = attackLanes.length > 0 || standDowns.length > 0 || state.redTeam.toolActivity.length > 0
  const hasL3 = rebuttals.length > 0
  const hasL4 = adjudications.length > 0

  const s1 = layerStatus(hasL1, hasL2, done)
  const s2 = layerStatus(hasL2, hasL3, done)
  const s3 = layerStatus(hasL3, hasL4, done)
  const s4 = layerStatus(hasL4, done, done)

  return (
    <div className="flex flex-col">
      {hasL1 && (
        <div>
          <LayerHeading n={1} label="Independent Research" />
          <div className="rounded-2xl border border-hairline bg-surface">
            <LayerCardHeader
              title="Theses"
              status={s1}
              sub={`${theses.length} of ${SPECIALISTS.length} specialists reported · parallel`}
            />
            <div className="grid grid-cols-1 gap-3.5 p-[18px] md:grid-cols-3">
              {started.map((s) => (
                <ThesisCard key={s} agent={s} lane={lanes[s]} manifest={manifest} />
              ))}
            </div>
          </div>
        </div>
      )}

      {hasL2 && (
        <div className="mt-5">
          <LayerHeading n={2} label="Adversarial Review" />
          <div className="rounded-2xl border border-hairline bg-surface">
            <LayerCardHeader title="Attacks" status={s2} sub={`${totalAttacks} attacks filed`} />
            <div className="p-[18px]">
              {state.redTeam.toolActivity.length > 0 && (
                <div className="mb-4">
                  <ToolActivity items={state.redTeam.toolActivity} label="Red-team tool activity" />
                </div>
              )}
              <div className="flex flex-col gap-[11px]">
                {SPECIALISTS.flatMap((s) =>
                  lanes[s].attacks.map((attack, i) => (
                    <div key={`${s}-${i}`} className="rounded-[10px] border border-hairline border-l-[3px] bg-raised/30 p-[14px_16px]" style={{ borderLeftColor: 'var(--color-redteam)' }}>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2.5">
                        <span className="font-mono text-[11.5px] text-ink-3">
                          Target: <b className="font-semibold text-ink-2">{AGENT_NAME[s]}</b> thesis
                        </span>
                        <span
                          className="rounded-[5px] px-[9px] py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[0.08em]"
                          style={{ color: 'var(--color-redteam)', background: 'color-mix(in oklab, var(--color-redteam) 14%, transparent)' }}
                        >
                          {attack.kind}
                        </span>
                      </div>
                      <p className="font-display text-[14px] leading-relaxed text-ink">{attack.critique}</p>
                      {attack.counter_evidence.length > 0 && (
                        <div className="mt-[11px] border-t border-hairline pt-2.5">
                          <EvidenceList evidence={attack.counter_evidence} manifest={manifest ?? undefined} collapsible />
                        </div>
                      )}
                    </div>
                  )),
                )}
                {standDowns.map((s) => (
                  <div key={s} className="rounded-[10px] border border-dashed border-hairline bg-page/40 p-[12px_16px]">
                    <div className="flex items-center gap-2">
                      <span className="rounded-[5px] border border-hairline px-2 py-[3px] font-mono text-[10px] font-semibold tracking-[0.08em] text-ink-3">
                        STANDS DOWN
                      </span>
                      <span className="font-mono text-[11.5px] text-ink-3">
                        on <b className="font-semibold text-ink-2">{AGENT_NAME[s]}</b>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {hasL3 && (
        <div className="mt-5">
          <LayerHeading n={3} label="Right of Reply" />
          <div className="rounded-2xl border border-hairline bg-surface">
            <LayerCardHeader title="Rebuttals" status={s3} sub="one reply per contested lens" />
            <div className="grid grid-cols-1 gap-3.5 p-[18px] md:grid-cols-2">
              {rebuttals.map((s) => {
                const lane = lanes[s]
                const from = lane.thesis!.stance
                const to = lane.rebuttal!.proposed_stance
                return (
                  <div key={s} className="flex flex-col gap-2.5 rounded-xl border border-hairline bg-raised/20 p-[15px]">
                    <div className="flex items-center gap-2">
                      <Avatar agent={s} size={28} />
                      <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-2">{AGENT_NAME[s]}</span>
                    </div>
                    <p className="font-display text-[14px] leading-relaxed text-ink-2">{lane.rebuttal!.response}</p>
                    <ToolActivity items={lane.rebuttalActivity} label="Researched via tools" />
                    <div className="tnum flex items-center gap-1.5 font-mono text-[11px] font-semibold">
                      <span style={{ color: poleColor(from) }}>{from >= 0 ? '+' : ''}{from.toFixed(2)}</span>
                      <span className="text-ink-3">→</span>
                      <span style={{ color: poleColor(to) }}>{to >= 0 ? '+' : ''}{to.toFixed(2)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {hasL4 && (
        <div className="mt-5"> 
          <LayerHeading n={4} label="Ruling" />
          <div className="rounded-2xl border border-hairline bg-surface">
            <LayerCardHeader title="Judgment" status={s4} sub={`${adjudications.length} attacks ruled on`} />
            <div className="p-[8px_20px_18px]">
              <div className="grid grid-cols-[1.3fr_0.9fr_0.9fr_2fr]">
                {['Attack', 'On', 'Ruling', 'Reasoning'].map((h) => (
                  <span key={h} className="border-b border-hairline p-3 font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                    {h}
                  </span>
                ))}
                {adjudications.map((s) => (
                  <RulingRow key={s} agent={s} lane={lanes[s]} />
                ))}
              </div>
              <p className="mt-3.5 border-t border-hairline pt-3 text-[11.5px] leading-relaxed text-ink-3">
                A <b className="font-semibold text-ink-2">logical challenge</b> disputes the reasoning; an{' '}
                <b className="font-semibold text-ink-2">evidence challenge</b> disputes a cited number. The judge's ruling —{' '}
                <span className="font-semibold" style={{ color: 'var(--color-bear)' }}>LANDED</span> /{' '}
                <span className="font-semibold" style={{ color: 'var(--color-neutralpole)' }}>PARTIAL</span> /{' '}
                <span className="font-semibold" style={{ color: 'var(--color-bull)' }}>DEFLECTED</span> — is whether the
                thesis conceded to the challenge, conceded in part, or held.
              </p>
              <GroundingGateNote state={state} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** One 01-layer grid cell: a reporting specialist's thesis, or the
 *  "researching…" placeholder for one that's started but hasn't yet. */
function ThesisCard({ agent, lane, manifest }: { agent: Specialist; lane: LaneState; manifest?: SnapshotManifest | null }) {
  if (!lane.thesis) {
    return (
      <div className="card-in flex flex-col gap-2.5 rounded-xl border border-hairline bg-raised/20 p-[15px]">
        <div className="flex items-center gap-[9px]">
          <Avatar agent={agent} size={30} />
          <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-ink-2">{AGENT_NAME[agent]}</span>
        </div>
        <p className="text-[13px] text-ink-3">
          researching<span className="thinking-dot">▊</span>
        </p>
        <ToolActivity items={lane.researchActivity} label="Fetching evidence" />
      </div>
    )
  }

  const abstained = lane.grounding ? !lane.grounding.gated_in : false
  const stance = lane.thesis.stance
  const stanceWord = stance > 0.001 ? 'Bull' : stance < -0.001 ? 'Bear' : 'Neutral'
  const stanceColor = poleColor(stance)

  return (
    <div className="card-in flex flex-col gap-[11px] rounded-xl border border-hairline bg-raised/20 p-[15px]">
      {/* header: identity left, compact stance-word pill right (the signed value
          moves to its own row below — a wide meter here overflowed the 3-up grid) */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-[9px]">
          <Avatar agent={agent} size={30} />
          <div className="min-w-0">
            <div className="truncate text-[11px] font-bold uppercase tracking-[0.09em] text-ink-2">{AGENT_NAME[agent]}</div>
            <div className="truncate text-[10.5px] text-ink-3">{AGENT_ROLE[agent]}</div>
          </div>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 font-mono text-[10.5px] font-bold tracking-[0.05em]"
          style={{ color: stanceColor, background: `color-mix(in oklab, ${stanceColor} 15%, transparent)` }}
        >
          {stanceWord}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] tracking-[0.14em] text-ink-3">STANCE</span>
        <MiniStance value={stance} />
      </div>
      {abstained && (
        <span className="w-fit rounded-[5px] border border-hairline px-2 py-[3px] font-mono text-[9.5px] font-semibold tracking-[0.1em] text-ink-3">
          ABSTAINED · NO VOTE
        </span>
      )}
      <p className="font-display text-[14.5px] leading-relaxed text-ink">{lane.thesis.summary}</p>
      <ToolActivity items={lane.researchActivity} label="Researched via tools" />
      {lane.thesis.evidence.length > 0 && (
        <div className="border-t border-hairline pt-[9px]">
          <EvidenceList evidence={lane.thesis.evidence} manifest={manifest ?? undefined} collapsible />
        </div>
      )}
    </div>
  )
}

/** The two challenge kinds the red-team can raise. The SSE contract only carries
 *  the bare `kind`, so we Title-case it and gloss it here (in the legend below the
 *  table) rather than leaving a cryptic lowercase "logical challenge" in the cell. */
const CHALLENGE_LABEL: Record<'evidence' | 'logical', string> = {
  evidence: 'Evidence challenge',
  logical: 'Logical challenge',
}

/** One 04-layer row: derives the Attack/Ruling cells from the lane's own
 *  attacks + adjudication — the contract has no title field, so "Attack" is
 *  described by kind (Title-cased via CHALLENGE_LABEL), and Ruling is computed
 *  from attacks_landed.length against the lane's own attack count. */
function RulingRow({ agent, lane }: { agent: Specialist; lane: LaneState }) {
  const adj = lane.adjudication!
  const attackCount = lane.attacks.length
  const landed = adj.attacks_landed.length

  const attackDesc = attackCount === 0
    ? '—'
    : [...new Set(lane.attacks.map((a) => CHALLENGE_LABEL[a.kind]))].join(', ')

  const ruling: 'LANDED' | 'PARTIAL' | 'DEFLECTED' =
    attackCount > 0 && landed >= attackCount ? 'LANDED' : landed > 0 ? 'PARTIAL' : 'DEFLECTED'

  const rulingColor = ruling === 'LANDED' ? 'var(--color-bear)' : ruling === 'PARTIAL' ? 'var(--color-neutralpole)' : 'var(--color-bull)'

  return (
    <>
      <span className="border-b border-hairline p-3 text-[12.5px] text-ink">{attackDesc}</span>
      <span className="border-b border-hairline p-3 text-[12.5px] text-ink-2">{AGENT_NAME[agent]}</span>
      <span className="border-b border-hairline p-3">
        <span
          className="rounded-[5px] px-[9px] py-[3px] font-mono text-[10px] font-bold"
          style={{ color: rulingColor, background: `color-mix(in oklab, ${rulingColor} 14%, transparent)` }}
        >
          {ruling}
        </span>
      </span>
      <span className="border-b border-hairline p-3 text-[12.5px] leading-relaxed text-ink-3">{adj.rationale}</span>
    </>
  )
}

/** The grounding-gate note bar below the ruling table — same derivation as
 *  Provenance's voting-lens count, naming the abstaining lens when exactly
 *  one exists. */
function GroundingGateNote({ state }: { state: DebateState }) {
  const lanes = SPECIALISTS.map((s) => ({ s, grounding: state.lanes[s].grounding }))
  const gated = lanes.filter((l) => l.grounding)
  if (gated.length === 0) return null
  const voting = gated.filter((l) => l.grounding!.gated_in).length
  const abstaining = gated.filter((l) => !l.grounding!.gated_in)

  return (
    <div className="mt-4 flex items-center gap-2.5 rounded-[9px] border px-4 py-3 text-[13px]"
         style={{ borderColor: 'color-mix(in oklab, var(--color-judge) 28%, transparent)', background: 'color-mix(in oklab, var(--color-judge) 8%, transparent)', color: 'var(--color-judge)' }}>
      <span>✓</span>
      <span>
        Evidence-grounding gate: <b className="font-semibold">{voting} / {SPECIALISTS.length}</b> lenses cleared the citation threshold
        {abstaining.length === 1 && <> — <b className="font-semibold">{AGENT_NAME[abstaining[0].s]}</b> abstained</>}
      </span>
    </div>
  )
}
