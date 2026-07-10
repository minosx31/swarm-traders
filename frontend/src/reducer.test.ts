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

test('specialist research tools (before the thesis) land in researchActivity', () => {
  const state = run([
    { type: 'agent_start', agent: 'fundamentals' },
    { type: 'tool_call', agent: 'fundamentals', tool: 'get_financials', args: {} },
    { type: 'tool_result', agent: 'fundamentals', tool: 'get_financials', data: { x: 1 } },
    { type: 'thesis', agent: 'fundamentals', stance: 0.6, summary: 's', evidence: [] },
  ])
  expect(state.lanes.fundamentals.researchActivity).toHaveLength(2)
  expect(state.lanes.fundamentals.rebuttalActivity).toHaveLength(0)
  expect(state.lanes.fundamentals.researchActivity[0]?.tool).toBe('get_financials')
})

test('rebuttal tools (after the thesis) land in rebuttalActivity, not research (#8)', () => {
  const state = run([
    { type: 'agent_start', agent: 'fundamentals' },
    { type: 'thesis', agent: 'fundamentals', stance: 0.6, summary: 's', evidence: [] },
    { type: 'attack', agent: 'red_team', target: 'fundamentals', kind: 'logical', critique: 'c', counter_evidence: [] },
    { type: 'tool_call', agent: 'fundamentals', tool: 'get_financials', args: {} },
    { type: 'tool_result', agent: 'fundamentals', tool: 'get_financials', data: { x: 1 } },
    { type: 'rebuttal', agent: 'fundamentals', proposed_stance: 0.5, response: 'r' },
  ])
  expect(state.lanes.fundamentals.rebuttalActivity).toHaveLength(2)
  expect(state.lanes.fundamentals.researchActivity).toHaveLength(0)
  expect(state.lanes.fundamentals.rebuttalActivity[0]?.tool).toBe('get_financials')
})

test('red-team tool activity is captured, not dropped, and survives its gate (#8)', () => {
  const state = run([
    { type: 'agent_start', agent: 'red_team' },
    { type: 'tool_call', agent: 'red_team', tool: 'get_news', args: {} },
    { type: 'tool_result', agent: 'red_team', tool: 'get_news', data: [] },
    { type: 'attack', agent: 'red_team', target: 'fundamentals', kind: 'logical',
      critique: 'c', counter_evidence: [] },
    { type: 'grounding', agent: 'red_team', gated_in: true, grounded: 1, dropped: 0 },
  ])
  expect(state.redTeam.toolActivity).toHaveLength(2)
  expect(state.redTeam.grounding?.gated_in).toBe(true) // grounding did not wipe toolActivity
})

test('a tool_result carries duration_s verbatim; older events without it still reduce fine (#13)', () => {
  const state = run([
    { type: 'agent_start', agent: 'red_team' },
    { type: 'tool_call', agent: 'red_team', tool: 'get_news', args: {} },
    { type: 'tool_result', agent: 'red_team', tool: 'get_news', data: [], duration_s: 0.6 },
    { type: 'tool_call', agent: 'red_team', tool: 'get_financials', args: {} },
    { type: 'tool_result', agent: 'red_team', tool: 'get_financials', data: {} }, // no duration_s
  ])
  expect(state.redTeam.toolActivity).toHaveLength(4)
  expect(state.redTeam.toolActivity[1]?.duration_s).toBe(0.6)
  expect(state.redTeam.toolActivity[3]?.duration_s).toBeUndefined()
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
