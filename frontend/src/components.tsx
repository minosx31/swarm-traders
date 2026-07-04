/** Shared atoms: agent chips, stance meters, evidence rows, evidence ledger. */

import type { ReactNode } from 'react'
import type { AgentName, EvidenceItem, GroundingEvent } from './types'

export const AGENT_COLOR: Record<AgentName, string> = {
  fundamentals: 'var(--color-fundamentals)',
  sentiment: 'var(--color-sentiment)',
  technicals: 'var(--color-technicals)',
  red_team: 'var(--color-redteam)',
  judge: 'var(--color-judge)',
}

export const AGENT_LABEL: Record<AgentName, string> = {
  fundamentals: 'FUNDAMENTALS',
  sentiment: 'SENTIMENT',
  technicals: 'TECHNICALS',
  red_team: 'RED-TEAM',
  judge: 'JUDGE',
}

export function AgentChip({ agent, thinking = false }: { agent: AgentName; thinking?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold tracking-[0.14em]">
      <span
        className={`h-2 w-2 ${thinking ? 'thinking-dot' : ''}`}
        style={{ background: AGENT_COLOR[agent] }}
      />
      <span className="text-ink-2">{AGENT_LABEL[agent]}</span>
    </span>
  )
}

export function poleColor(value: number): string {
  if (value > 0.001) return 'var(--color-bull)'
  if (value < -0.001) return 'var(--color-bear)'
  return 'var(--color-neutralpole)'
}

/** A colored capsule label — the section marker for a debate-timeline entry
 *  (THESIS, ATTACK, REBUTTAL…). The tint is derived from the entry color so
 *  the badge, node, and accent all read as one identity. */
export function Pill({ children, color, dashed = false }: {
  children: ReactNode
  color: string
  dashed?: boolean
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[4px] px-2 py-[3px] font-mono text-[9.5px] font-semibold tracking-[0.14em]"
      style={{
        color,
        background: `color-mix(in oklab, ${color} 15%, transparent)`,
        border: dashed ? `1px dashed color-mix(in oklab, ${color} 45%, transparent)` : undefined,
      }}
    >
      {children}
    </span>
  )
}

/** Compact signed stance in [-1,+1] for a timeline entry: a centered bar whose
 *  fill grows from the midline (LEFT = bearish, RIGHT = bullish) plus the signed
 *  value. Sign lives in the SIDE, not just the color. */
export function MiniStance({ value }: { value: number }) {
  const magnitude = Math.min(Math.abs(value), 1) * 50
  const side = value >= 0 ? { left: '50%' } : { right: '50%' }
  const color = poleColor(value)
  return (
    <span className="ml-auto flex items-center gap-2" role="img"
          aria-label={`stance ${value >= 0 ? '+' : ''}${value.toFixed(2)}`}>
      <span className="relative h-1 w-[72px] rounded-full bg-raised">
        <span className="absolute -top-1 -bottom-1 left-1/2 w-px bg-ink-3/40" />
        <span className="meter-fill absolute inset-y-0 rounded-full"
              style={{ ...side, width: `${magnitude}%`, background: color }} />
      </span>
      <span className="tnum text-[12px] font-semibold" style={{ color }}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </span>
    </span>
  )
}

/** One evidence line. GROUNDED reads as "data the swarm actually used" —
 *  green key, resolved cite. DROPPED reads as a quiet failed-validation note,
 *  never a strikethrough that shouts over the grounded rows. */
export function EvidenceRow({ item }: { item: EvidenceItem }) {
  const cite = item.citation_key ?? item.source_id ?? '—'
  if (item.grounded) {
    return (
      <li className="flex gap-2 border-l-2 border-judge/70 pl-2 text-[13px] leading-snug">
        <span className="mt-[3px] shrink-0 text-[11px] text-judge">✓</span>
        <span className="min-w-0">
          <span className="text-ink-2">{item.claim}</span>
          <code className="ml-1.5 break-all text-[12px] text-judge/80">{cite}</code>
          {item.verified_quote && (
            <span className="ml-1.5 whitespace-nowrap text-[11px] font-semibold tracking-wider text-judge">
              ✓ VERIFIED QUOTE
            </span>
          )}
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1.5 whitespace-nowrap text-[12px] font-medium text-fundamentals hover:underline"
            >
              ↗ source
            </a>
          )}
        </span>
      </li>
    )
  }
  return (
    <li className="flex gap-2 border-l-2 border-hairline pl-2 text-[13px] leading-snug text-ink-3">
      <span className="mt-[3px] shrink-0 text-[11px] text-bear/70">✗</span>
      <span className="min-w-0">
        <span>{item.claim}</span>
        <code className="ml-1.5 break-all text-[11px] text-ink-3/70">{cite}</code>
        {item.reason && <span className="ml-1.5 text-[11px] text-bear/80">— {item.reason}</span>}
      </span>
    </li>
  )
}

/** An agent's citations split into what earned the vote (grounded, foregrounded)
 *  and what failed validation (dropped, folded into a quiet expander). This is
 *  the "what data was used vs. what failed" split the ledger is built around. */
export function EvidenceLedger({ evidence, emptyLabel }: {
  evidence: EvidenceItem[]
  emptyLabel?: string
}) {
  if (evidence.length === 0) {
    return emptyLabel ? <p className="text-[10.5px] italic text-ink-3">{emptyLabel}</p> : null
  }
  const grounded = evidence.filter((e) => e.grounded)
  const dropped = evidence.filter((e) => !e.grounded)
  return (
    <div className="flex flex-col gap-2">
      {grounded.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {grounded.map((item, i) => <EvidenceRow key={i} item={item} />)}
        </ul>
      )}
      {dropped.length > 0 && (
        <details className="disc">
          <summary className="flex items-center gap-1 text-[11px] font-semibold tracking-[0.16em] text-ink-3">
            <span className="disc-caret text-[8px]" />
            {dropped.length} CITATION{dropped.length > 1 ? 'S' : ''} FAILED VALIDATION
          </summary>
          <ul className="disc-body mt-1.5 flex flex-col gap-1.5">
            {dropped.map((item, i) => <EvidenceRow key={i} item={item} />)}
          </ul>
        </details>
      )}
    </div>
  )
}

/** The per-lane grounding gate result — the validation outcome, made legible:
 *  a colored dot + verdict. Preserves the exact "GATED OUT · NO VOTE" copy. */
export function ValidationBadge({ grounding }: { grounding?: GroundingEvent }) {
  if (!grounding) return null
  const ok = grounding.gated_in
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.16em] ${
      ok ? 'text-judge' : 'text-bear'
    }`}>
      <span className="h-1.5 w-1.5 rounded-full"
            style={{ background: ok ? 'var(--color-judge)' : 'var(--color-bear)' }} />
      {ok ? `✦ VOTES · ${grounding.grounded} GROUNDED` : 'GATED OUT · NO VOTE'}
    </span>
  )
}

export function SectionTag({ children, color }: { children: string; color?: string }) {
  return (
    <div className="mb-1 text-[11px] font-semibold tracking-[0.22em]"
         style={{ color: color ?? 'var(--color-ink-3)' }}>
      {children}
    </div>
  )
}
