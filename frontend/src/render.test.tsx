/** DOM-level smoke test: reduce a recorded run into the components.
 *  Doubles as issue #9's "frontend renders a recorded log" check.
 *
 *  Runs against COMMITTED fixtures (src/fixtures/*.json), not the mutable
 *  backend/data/runs/ directory — LLM output is non-deterministic, so asserting
 *  on "the latest live run" is inherently flaky. The fixtures are frozen copies
 *  of two real recorded runs (one reaching a verdict, one terminating in error). */

import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'

afterEach(cleanup)
import { Lane } from './Lane'
import { VerdictPanel } from './VerdictPanel'
import { debateReducer, initialState } from './reducer'
import type { DebateEvent } from './types'

const FIXTURES = join(import.meta.dir, 'fixtures')
const loadFixture = (name: string): { events: DebateEvent[] } =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))

test('a recorded verdict run reduces and renders: lanes, gate results, verdict', () => {
  const { events } = loadFixture('verdict-run.json')
  const state = events.reduce(debateReducer, initialState)

  render(
    <main>
      <Lane agent="fundamentals" lane={state.lanes.fundamentals} />
      <Lane agent="sentiment" lane={state.lanes.sentiment} />
      <Lane agent="technicals" lane={state.lanes.technicals} />
      <VerdictPanel state={state} ticker="NVDA" asOf="2026-07-02" />
    </main>,
  )

  expect(screen.getByText('FUNDAMENTALS')).toBeTruthy()
  // this frozen fixture: sentiment gated out, verdict BEAR, N=2
  expect(screen.getByText('GATED OUT · NO VOTE')).toBeTruthy()
  expect(screen.getByText(/BEAR/)).toBeTruthy()
  expect(screen.getByText('N=2')).toBeTruthy()
  // structural invariants that hold for ANY verdict run, whatever the model said:
  // conviction is never shown without N and dissent
  expect(screen.getByText('CONVICTION')).toBeTruthy()
  expect(screen.getByText('DISSENT')).toBeTruthy()
  // outcome absent from the DOM until explicitly revealed
  expect(screen.queryByText(/what actually happened/)).toBeNull()
  expect(screen.getByText('▣ REVEAL THE OUTCOME')).toBeTruthy()
})

test('an error-terminated recorded run still renders lanes without crashing', () => {
  const { events } = loadFixture('error-run.json')
  const state = events.reduce(debateReducer, initialState)
  expect(state.phase).toBe('error')
  const { unmount } = render(
    <main>
      <Lane agent="fundamentals" lane={state.lanes.fundamentals} />
      <Lane agent="sentiment" lane={state.lanes.sentiment} />
      <Lane agent="technicals" lane={state.lanes.technicals} />
    </main>,
  )
  // lanes that got a thesis before the error still render it
  expect(screen.getByText('FUNDAMENTALS')).toBeTruthy()
  unmount()
})
