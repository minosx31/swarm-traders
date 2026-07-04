/** useReducer over the SSE event union, keyed by agent (ARCHITECTURE §7). */

import {
  SPECIALISTS,
  type AttackEvent,
  type AdjudicationEvent,
  type DebateEvent,
  type ErrorEvent,
  type GroundingEvent,
  type RebuttalEvent,
  type Specialist,
  type ThesisEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type VerdictEvent,
} from './types'

export interface LaneState {
  status: 'idle' | 'thinking' | 'spoke'
  thesis?: ThesisEvent
  grounding?: GroundingEvent
  attacks: AttackEvent[]
  toolActivity: (ToolCallEvent | ToolResultEvent)[]
  rebuttal?: RebuttalEvent
  adjudication?: AdjudicationEvent
}

export interface DebateState {
  phase: 'idle' | 'streaming' | 'done' | 'error'
  lanes: Record<Specialist, LaneState>
  redTeam: { status: LaneState['status']; grounding?: GroundingEvent }
  judgeActive: boolean
  verdict?: VerdictEvent
  error?: ErrorEvent
  eventCount: number
}

const emptyLane = (): LaneState => ({ status: 'idle', attacks: [], toolActivity: [] })

export const initialState: DebateState = {
  phase: 'idle',
  lanes: { fundamentals: emptyLane(), sentiment: emptyLane(), technicals: emptyLane() },
  redTeam: { status: 'idle' },
  judgeActive: false,
  verdict: undefined,
  error: undefined,
  eventCount: 0,
}

const isSpecialist = (agent: string): agent is Specialist =>
  (SPECIALISTS as readonly string[]).includes(agent)

function updateLane(
  state: DebateState,
  agent: string,
  patch: Partial<LaneState>,
): DebateState {
  if (!isSpecialist(agent)) return state
  return {
    ...state,
    lanes: { ...state.lanes, [agent]: { ...state.lanes[agent], ...patch } },
  }
}

export function debateReducer(prev: DebateState, event: DebateEvent): DebateState {
  const state: DebateState = { ...prev, eventCount: prev.eventCount + 1, phase: 'streaming' }
  switch (event.type) {
    case 'agent_start':
      if (event.agent === 'red_team') return { ...state, redTeam: { ...state.redTeam, status: 'thinking' } }
      if (event.agent === 'judge') return { ...state, judgeActive: true }
      return updateLane(state, event.agent, { status: 'thinking' })
    case 'thesis':
      return updateLane(state, event.agent, { thesis: event, status: 'spoke' })
    case 'grounding':
      if (event.agent === 'red_team')
        return { ...state, redTeam: { status: 'spoke', grounding: event } }
      return updateLane(state, event.agent, { grounding: event })
    case 'attack': {
      const lane = state.lanes[event.target]
      if (!lane) return state
      return updateLane(state, event.target, { attacks: [...lane.attacks, event] })
    }
    case 'tool_call':
    case 'tool_result': {
      const lane = isSpecialist(event.agent) ? state.lanes[event.agent] : undefined
      if (!lane) return state
      return updateLane(state, event.agent, {
        toolActivity: [...lane.toolActivity, event],
        status: 'thinking',
      })
    }
    case 'rebuttal':
      return updateLane(state, event.agent, { rebuttal: event, status: 'spoke' })
    case 'adjudication':
      return updateLane(state, event.agent, { adjudication: event })
    case 'verdict':
      return { ...state, verdict: event, phase: 'done' }
    case 'error':
      return { ...state, error: event, phase: 'error' }
    default:
      return state // unknown event types must never crash the reducer
  }
}
