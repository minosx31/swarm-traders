/** TypeScript mirror of the SSE event contract (ARCHITECTURE §3). */

export const SPECIALISTS = ['fundamentals', 'sentiment', 'technicals'] as const
export type Specialist = (typeof SPECIALISTS)[number]
export type AgentName = Specialist | 'red_team' | 'judge'

export interface EvidenceItem {
  kind: 'numeric' | 'textual'
  claim: string
  citation_key?: string
  cited_value?: number
  source_id?: string
  quoted_span?: string
  grounded: boolean
  reason?: string
  verified_quote?: boolean
}

export interface AgentStartEvent {
  type: 'agent_start'
  agent: AgentName
}
export interface ThesisEvent {
  type: 'thesis'
  agent: Specialist
  stance: number
  summary: string
  evidence: EvidenceItem[]
}
export interface GroundingEvent {
  type: 'grounding'
  agent: Specialist | 'red_team'
  gated_in: boolean
  grounded: number
  dropped: number
}
export interface AttackEvent {
  type: 'attack'
  agent: 'red_team'
  target: Specialist
  kind: 'evidence' | 'logical'
  critique: string
  counter_evidence: EvidenceItem[]
}
export interface ToolCallEvent {
  type: 'tool_call'
  agent: AgentName
  tool: string
  args: Record<string, unknown>
}
export interface ToolResultEvent {
  type: 'tool_result'
  agent: AgentName
  tool: string
  data: unknown
}
export interface RebuttalEvent {
  type: 'rebuttal'
  agent: Specialist
  proposed_stance: number
  response: string
}
export interface AdjudicationEvent {
  type: 'adjudication'
  agent: Specialist
  adjudicated_stance: number
  attacks_landed: string[]
  rationale?: string
}
export interface VerdictEvent {
  type: 'verdict'
  direction: 'bull' | 'bear' | 'neutral' | 'no_call'
  aggregate_stance?: number
  conviction?: number
  high_conviction?: boolean
  dissent?: 'low' | 'med' | 'high'
  voting_lenses: number
  reason?: string
}
export interface ErrorEvent {
  type: 'error'
  error: string
  message: string
}

export type DebateEvent =
  | AgentStartEvent
  | ThesisEvent
  | GroundingEvent
  | AttackEvent
  | ToolCallEvent
  | ToolResultEvent
  | RebuttalEvent
  | AdjudicationEvent
  | VerdictEvent
  | ErrorEvent

export interface Outcome {
  note: string
  as_of: string
  prices_after: { date: string; close: number; volume: number }[]
}

export interface WhitelistPair {
  ticker: string
  as_of: string
}
