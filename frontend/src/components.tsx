/** Shared atoms: agent chips, stance meters, evidence rows. */

import type { AgentName, EvidenceItem } from './types'

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
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em]">
      <span
        className={`h-2 w-2 ${thinking ? 'thinking-dot' : ''}`}
        style={{ background: AGENT_COLOR[agent] }}
      />
      <span className="text-ink-2">{AGENT_LABEL[agent]}</span>
    </span>
  )
}

function poleColor(value: number): string {
  if (value > 0.001) return 'var(--color-bull)'
  if (value < -0.001) return 'var(--color-bear)'
  return 'var(--color-neutralpole)'
}

/** Signed stance in [-1,+1]: sign is encoded by the SIDE of the midline;
 *  color + the numeric label are reinforcement, never the only channel. */
export function StanceMeter({ value, label }: { value: number; label: string }) {
  const magnitude = Math.min(Math.abs(value), 1) * 50
  const side = value >= 0 ? { left: '50%' } : { right: '50%' }
  return (
    <div className="flex items-center gap-2" role="img"
         aria-label={`${label}: stance ${value >= 0 ? '+' : ''}${value.toFixed(2)}`}>
      <span className="w-16 shrink-0 text-[10px] tracking-[0.12em] text-ink-3">{label}</span>
      <div className="relative h-[7px] flex-1 rounded-xs bg-raised">
        <span className="absolute top-[-2px] bottom-[-2px] left-1/2 w-px bg-hairline" />
        <span
          className="meter-fill absolute top-0 bottom-0 rounded-xs"
          style={{ ...side, width: `${magnitude}%`, background: poleColor(value) }}
        />
      </div>
      <span className="tnum w-12 shrink-0 text-right text-[11px] font-medium"
            style={{ color: poleColor(value) }}>
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
      </span>
    </div>
  )
}

export function EvidenceRow({ item }: { item: EvidenceItem }) {
  const cite = item.citation_key ?? item.source_id ?? '—'
  return (
    <li className={`border-l pl-2 text-[11.5px] leading-snug ${item.grounded ? 'border-hairline' : 'border-bear/60'}`}>
      <span className={item.grounded ? 'text-ink-2' : 'text-ink-3 line-through decoration-bear/50'}>
        {item.claim}
      </span>
      <span className="ml-1.5 whitespace-nowrap text-[10px] text-ink-3">[{cite}]</span>
      {item.verified_quote && (
        <span className="ml-1.5 whitespace-nowrap text-[9.5px] font-semibold tracking-wider text-judge">
          ✓ VERIFIED QUOTE
        </span>
      )}
      {!item.grounded && (
        <span className="ml-1.5 whitespace-nowrap text-[9.5px] font-semibold tracking-wider text-bear">
          ✗ DROPPED{item.reason ? ` — ${item.reason}` : ''}
        </span>
      )}
    </li>
  )
}

export function SectionTag({ children, color }: { children: string; color?: string }) {
  return (
    <div className="mb-1 text-[9.5px] font-semibold tracking-[0.22em]"
         style={{ color: color ?? 'var(--color-ink-3)' }}>
      {children}
    </div>
  )
}
