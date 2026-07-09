/** Shared atoms: agent identity, stance meters, avatars, click-to-verify evidence. */

import { useState, type ReactNode } from 'react'
import type { AgentName, EvidenceItem, GroundingEvent, SnapshotManifest } from './types'

export const AGENT_COLOR: Record<AgentName, string> = {
  fundamentals: 'var(--color-fundamentals)',
  sentiment: 'var(--color-sentiment)',
  technicals: 'var(--color-technicals)',
  red_team: 'var(--color-redteam)',
  judge: 'var(--color-judge)',
}

/** Uppercase wordmark — footer chips, compact labels. */
export const AGENT_LABEL: Record<AgentName, string> = {
  fundamentals: 'FUNDAMENTALS',
  sentiment: 'SENTIMENT',
  technicals: 'TECHNICALS',
  red_team: 'RED-TEAM',
  judge: 'JUDGE',
}

/** Title-case name + one-line role — thread headers and the orchestration key. */
export const AGENT_NAME: Record<AgentName, string> = {
  fundamentals: 'Fundamentals',
  sentiment: 'Sentiment',
  technicals: 'Technicals',
  red_team: 'Red-Team',
  judge: 'Judge',
}

export const AGENT_ROLE: Record<AgentName, string> = {
  fundamentals: 'Balance sheet & earnings',
  sentiment: 'News & narrative',
  technicals: 'Price & momentum',
  red_team: 'Adversarial challenger',
  judge: 'Adjudicator',
}

export const AGENT_INITIAL: Record<AgentName, string> = {
  fundamentals: 'F',
  sentiment: 'S',
  technicals: 'T',
  red_team: 'R',
  judge: 'J',
}

export function AgentChip({ agent, thinking = false }: { agent: AgentName; thinking?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[0.1em]">
      <span
        className={`h-2 w-2 rounded-[2px] ${thinking ? 'thinking-dot' : ''}`}
        style={{ background: AGENT_COLOR[agent] }}
      />
      <span className="text-ink-3">{AGENT_LABEL[agent]}</span>
    </span>
  )
}

export function poleColor(value: number): string {
  if (value > 0.001) return 'var(--color-bull)'
  if (value < -0.001) return 'var(--color-bear)'
  return 'var(--color-neutralpole)'
}

/** The tinted rounded-square initial that anchors an agent's identity in a card. */
export function Avatar({ agent, size = 38 }: { agent: AgentName; size?: number }) {
  const color = AGENT_COLOR[agent]
  return (
    <span
      className="flex shrink-0 items-center justify-center font-display font-semibold"
      style={{
        width: size,
        height: size,
        borderRadius: size >= 34 ? 10 : 7,
        fontSize: size >= 34 ? 18 : 13,
        background: `color-mix(in oklab, ${color} 20%, var(--color-surface))`,
        border: `1px solid color-mix(in oklab, ${color} 55%, transparent)`,
        color,
      }}
    >
      {AGENT_INITIAL[agent]}
    </span>
  )
}

/** A colored capsule label — the section marker for a debate entry
 *  (THESIS, ATTACK, REBUTTAL…). The tint is derived from the entry color so
 *  the badge, node, and accent all read as one identity. */
export function Pill({ children, color, dashed = false }: {
  children: ReactNode
  color: string
  dashed?: boolean
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[5px] px-2 py-[3px] font-mono text-[9.5px] font-semibold tracking-[0.12em]"
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

/** Compact signed stance in [-1,+1]: a centered bar whose fill grows from the
 *  midline (LEFT = bearish, RIGHT = bullish) plus the signed value. Sign lives
 *  in the SIDE, not just the color. */
export function MiniStance({ value }: { value: number }) {
  const magnitude = Math.min(Math.abs(value), 1) * 50
  const side = value >= 0 ? { left: '50%' } : { right: '50%' }
  const color = poleColor(value)
  return (
    <span className="ml-auto flex items-center gap-2" role="img"
          aria-label={`stance ${value >= 0 ? '+' : ''}${value.toFixed(2)}`}>
      <span className="relative h-1 w-[74px] rounded-full bg-raised">
        <span className="absolute -top-[3px] -bottom-[3px] left-1/2 w-px bg-ink-3/40" />
        <span className="meter-fill absolute inset-y-0 rounded-full"
              style={{ ...side, width: `${magnitude}%`, background: color }} />
      </span>
      <span className="tnum font-mono text-[12px] font-semibold" style={{ color }}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </span>
    </span>
  )
}

/** Shared numeric formatter — percentages for fractional values, $B/$M for large
 *  magnitudes, otherwise a plain localized number. Used for both the cited value
 *  and its snapshot cross-check, so the two are visually comparable. */
export const fmtVal = (v?: number): string => {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a < 1) return (v * 100).toFixed(2) + '%'
  if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'
  if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'
  return v.toLocaleString()
}

/** Resolve a citation_key against the snapshot's key spaces (fundamentals +
 *  technicals) for the value cross-check and the source link. Exact-match only —
 *  a comma-separated bad key (multiple citations in one string) simply won't
 *  resolve, which is the correct "can't verify" outcome, not a crash. */
function resolveSnapshotKey(citationKey: string | undefined, manifest: SnapshotManifest | undefined) {
  if (!citationKey || !manifest) return null
  if (citationKey.startsWith('income_stmt.') || citationKey.startsWith('balance_sheet.')) {
    const keys = manifest.fundamentals?.keys
    if (keys && citationKey in keys) {
      return { value: keys[citationKey], sourceUrl: manifest.fundamentals!.source_url }
    }
    return null
  }
  if (citationKey.startsWith('technicals.')) {
    const keys = manifest.technicals.keys
    if (citationKey in keys) {
      return { value: keys[citationKey], sourceUrl: manifest.prices.source_url }
    }
    return null
  }
  return null
}

/** One citation, collapsed to a claim + key with a grounded/dropped accent,
 *  expanding on tap to the cited value, its validation verdict, and any source.
 *  This is the "tap a citation to verify" contract from the design. When a
 *  `manifest` is available, numeric citations also show the snapshot's own value
 *  under the same key — a direct, user-checkable cross-check — plus a link to
 *  where that datum came from. */
function EvidenceRow({ item, manifest }: { item: EvidenceItem; manifest?: SnapshotManifest }) {
  const [open, setOpen] = useState(false)
  const grounded = item.grounded
  const cite = item.citation_key ?? item.source_id ?? '—'
  const snapshotMatch = resolveSnapshotKey(item.citation_key, manifest)
  return (
    <div className="overflow-hidden rounded-lg">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="ev-row flex w-full items-start gap-2 py-1.5 pl-2 pr-2 text-left"
        style={{ borderLeft: `2px solid ${grounded ? 'color-mix(in oklab, var(--color-judge) 60%, transparent)' : 'var(--color-hairline)'}` }}
        aria-expanded={open}
      >
        <span className="mt-px shrink-0 text-[11px]" style={{ color: grounded ? 'var(--color-judge)' : 'var(--color-ink-3)' }}>
          {grounded ? '✓' : '✗'}
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-2">
          {item.claim}
          <code className="ml-1.5 break-all font-mono text-[11px]"
                style={{ color: grounded ? 'color-mix(in oklab, var(--color-judge) 85%, white)' : 'color-mix(in oklab, var(--color-ink-3) 80%, transparent)' }}>
            {cite}
          </code>
        </span>
        <span className="mt-[3px] shrink-0 text-[9px] text-ink-3">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="card-in py-2 pl-[18px] pr-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="text-ink-3">cited value</span>
            <span className="font-semibold text-ink">{fmtVal(item.cited_value)}</span>
            <span
              className="rounded-[4px] px-1.5 py-px text-[9.5px] font-semibold tracking-[0.08em]"
              style={grounded
                ? { color: 'var(--color-judge)', background: 'color-mix(in oklab, var(--color-judge) 14%, transparent)' }
                : { color: 'var(--color-bear)', background: 'color-mix(in oklab, var(--color-bear) 12%, transparent)' }}
            >
              {grounded ? 'GROUNDED' : 'DROPPED'}
            </span>
          </div>
          {snapshotMatch && (
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[11px]">
              <span className="text-ink-3">snapshot</span>
              <span className="font-semibold text-ink">{fmtVal(snapshotMatch.value)}</span>
            </div>
          )}
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
            {grounded
              ? `Value matched the point-in-time snapshot under key ${cite}.`
              : `Failed validation — ${item.reason ?? 'could not be resolved against the snapshot'}.`}
          </p>
          {item.verified_quote && (
            <span className="mt-1.5 inline-block font-mono text-[10px] font-semibold tracking-[0.1em] text-judge">
              ✓ VERIFIED QUOTE
            </span>
          )}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer"
               className="mt-1.5 inline-block text-[12px] text-fundamentals hover:underline">
              ↗ open source
            </a>
          )}
          {!item.url && snapshotMatch && (
            <a href={snapshotMatch.sourceUrl} target="_blank" rel="noopener noreferrer"
               className="mt-1.5 inline-block text-[12px] text-fundamentals hover:underline">
              ↗ open source
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/** The tappable evidence stack for a thesis or attack. */
export function EvidenceList({ evidence, emptyLabel, manifest }: {
  evidence: EvidenceItem[]
  emptyLabel?: string
  manifest?: SnapshotManifest
}) {
  if (evidence.length === 0) {
    return emptyLabel ? <p className="text-[10.5px] italic text-ink-3">{emptyLabel}</p> : null
  }
  return (
    <div className="flex flex-col gap-[5px]">
      {evidence.map((item, i) => <EvidenceRow key={i} item={item} manifest={manifest} />)}
    </div>
  )
}

/** The per-lane grounding gate result — the validation outcome, made legible:
 *  a colored dot + verdict. Preserves the exact "GATED OUT · NO VOTE" copy. */
export function ValidationBadge({ grounding }: { grounding?: GroundingEvent }) {
  if (!grounding) return null
  const ok = grounding.gated_in
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] ${
      ok ? 'text-judge' : 'text-bear'
    }`}>
      <span className="h-1.5 w-1.5 rounded-full"
            style={{ background: ok ? 'var(--color-judge)' : 'var(--color-bear)' }} />
      {ok ? `VOTES · ${grounding.grounded} GROUNDED` : 'GATED OUT · NO VOTE'}
    </span>
  )
}

export function SectionTag({ children, color }: { children: string; color?: string }) {
  return (
    <div className="font-mono text-[10.5px] font-semibold tracking-[0.22em]"
         style={{ color: color ?? 'var(--color-ink-3)' }}>
      {children}
    </div>
  )
}
