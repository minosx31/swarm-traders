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
  url?: string
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
  duration_s?: number // absent on older recordings (#13)
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

/** GET /snapshot?ticker&as_of — the exact point-in-time data fed to the agents
 *  (ADR 0002), for the Provenance manifest panel + per-citation cross-check.
 *  `fundamentals` is null when the pair has none reported as-of the cutoff. */
export interface SnapshotPrices {
  bars: number
  first_date: string
  last_date: string
  source_url: string
}
export interface SnapshotFundamentals {
  period_end: string
  available_at: string
  source_url: string
  keys: Record<string, number>
}
export interface SnapshotTechnicals {
  keys: Record<string, number>
}
export interface SnapshotNewsItem {
  source_id: string
  title: string
  published_at: string
  url?: string | null
}
export interface SnapshotLeakCheck {
  violations: string[]
}
export interface SnapshotManifest {
  ticker: string
  as_of: string
  prices: SnapshotPrices
  fundamentals: SnapshotFundamentals | null
  technicals: SnapshotTechnicals
  news: SnapshotNewsItem[]
  leak_check: SnapshotLeakCheck
}

/** A selectable (backend, model) pair from GET /models. */
export interface ModelOption {
  backend: string // llm.py backend name: ollama | haiku | sonnet | groq
  model: string
  label: string
  paid: boolean // true ⇒ real API credits (Claude); UI warns + confirms
}

/** A recorded run from GET /runs, for the replay 'which model' picker. */
export interface RunOption {
  run: string // filename, passed back as ?run= to replay this exact recording
  model: string
  recorded_at: string // compact UTC stamp, e.g. 20260704T031559Z
}
