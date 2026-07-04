/** Issue #7 acceptance: the reducer mirrors the SSE contract and never crashes. */

import { expect, test } from 'bun:test'
import { debateReducer, initialState, type DebateState } from './reducer'
import type { DebateEvent } from './types'

const run = (events: unknown[]): DebateState =>
  (events as DebateEvent[]).reduce(debateReducer, initialState)

const FULL_RUN: unknown[] = [
  { type: 'agent_start', agent: 'fundamentals' },
  { type: 'thesis', agent: 'fundamentals', stance: 0.7, summary: 's', evidence: [
    { kind: 'numeric', claim: 'c', citation_key: 'k', cited_value: 1, grounded: true }] },
  { type: 'grounding', agent: 'fundamentals', gated_in: true, grounded: 1, dropped: 0 },
  { type: 'agent_start', agent: 'red_team' },
  { type: 'attack', agent: 'red_team', target: 'fundamentals', kind: 'logical',
    critique: 'over-extrapolated', counter_evidence: [] },
  { type: 'grounding', agent: 'red_team', gated_in: true, grounded: 1, dropped: 0 },
  { type: 'rebuttal', agent: 'fundamentals', proposed_stance: 0.5, response: 'r' },
  { type: 'adjudication', agent: 'fundamentals', adjudicated_stance: 0.4,
    attacks_landed: ['over-extrapolated'] },
  { type: 'verdict', direction: 'bull', aggregate_stance: 0.4, conviction: 0.4,
    high_conviction: false, dissent: 'low', voting_lenses: 2 },
]

test('full event sequence reduces into lanes + verdict', () => {
  const state = run(FULL_RUN)
  const lane = state.lanes.fundamentals
  expect(lane.thesis?.stance).toBe(0.7)
  expect(lane.grounding?.gated_in).toBe(true)
  expect(lane.attacks).toHaveLength(1)
  expect(lane.rebuttal?.proposed_stance).toBe(0.5)
  expect(lane.adjudication?.adjudicated_stance).toBe(0.4)
  expect(state.verdict?.direction).toBe('bull')
  expect(state.phase).toBe('done')
  expect(state.eventCount).toBe(FULL_RUN.length)
})

test('attacks land in the TARGET lane, not a red-team lane', () => {
  const state = run(FULL_RUN)
  expect(state.lanes.fundamentals.attacks[0]?.critique).toBe('over-extrapolated')
  expect(state.lanes.sentiment.attacks).toHaveLength(0)
})

test('unknown event types never crash the reducer', () => {
  const state = run([
    { type: 'agent_start', agent: 'fundamentals' },
    { type: 'totally_new_event', payload: 42 },
    { type: 'from_the_future', agent: 'macro' },
  ])
  expect(state.eventCount).toBe(3)
  expect(state.phase).toBe('streaming')
})

test('unknown agents in known events are ignored, not fatal', () => {
  const state = run([
    { type: 'agent_start', agent: 'macro' },
    { type: 'thesis', agent: 'macro', stance: 0.1, summary: 's', evidence: [] },
  ])
  expect(state.lanes.fundamentals.thesis).toBeUndefined()
})

test('terminal error event flips phase and is preserved', () => {
  const state = run([{ type: 'error', error: 'BreakerTripped', message: 'killed' }])
  expect(state.phase).toBe('error')
  expect(state.error?.error).toBe('BreakerTripped')
})

test('no-call verdict carries its reason through', () => {
  const state = run([
    { type: 'verdict', direction: 'no_call', voting_lenses: 1, reason: 'quorum not met' },
  ])
  expect(state.verdict?.direction).toBe('no_call')
  expect(state.verdict?.reason).toContain('quorum')
})
