/** DOM-level smoke test: reduce a REAL recorded run into the components.
 *  Doubles as issue #9's "frontend renders a recorded log" check. */

import { afterEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'

afterEach(cleanup)
import { Lane } from './Lane'
import { VerdictPanel } from './VerdictPanel'
import { debateReducer, initialState } from './reducer'
import type { DebateEvent } from './types'

const RUNS_DIR = join(import.meta.dir, '..', '..', 'backend', 'data', 'runs')

const runFiles = (): string[] =>
  readdirSync(RUNS_DIR).filter((f: string) => f.endsWith('.json')).sort()

function latestRecordedRun(): { events: DebateEvent[] } {
  const files = runFiles()
  return JSON.parse(readFileSync(join(RUNS_DIR, files[files.length - 1]), 'utf8'))
}

test('a real recorded run reduces and renders: lanes, gate results, verdict', () => {
  const { events } = latestRecordedRun()
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
  // the recorded qwen2.5 run: sentiment gated out, verdict BEAR, N=2
  expect(screen.getByText('GATED OUT · NO VOTE')).toBeTruthy()
  expect(screen.getByText(/BEAR/)).toBeTruthy()
  expect(screen.getByText('N=2')).toBeTruthy()
  // conviction never shown without N and dissent
  expect(screen.getByText('CONVICTION')).toBeTruthy()
  expect(screen.getByText('DISSENT')).toBeTruthy()
  // outcome absent from the DOM until explicitly revealed
  expect(screen.queryByText(/what actually happened/)).toBeNull()
  expect(screen.getByText('▣ REVEAL THE OUTCOME')).toBeTruthy()
})

test('error-terminated recorded runs still render lanes without crashing', () => {
  for (const file of runFiles()) {
    const { events } = JSON.parse(readFileSync(join(RUNS_DIR, file), 'utf8'))
    const state = (events as DebateEvent[]).reduce(debateReducer, initialState)
    const { unmount } = render(<Lane agent="technicals" lane={state.lanes.technicals} />)
    unmount()
  }
})
