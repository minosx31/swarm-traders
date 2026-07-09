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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

afterEach(cleanup)
import { LayerFeed } from './Layers'
import { VerdictPanel } from './VerdictPanel'
import { Provenance } from './Provenance'
import { EvidenceList } from './components'
import { debateReducer, initialState } from './reducer'
import type { DebateEvent, SnapshotManifest } from './types'

const noOutcome = { outcome: null, onReveal: () => {}, outcomeError: null }

const FIXTURES = join(import.meta.dir, 'fixtures')
const loadFixture = (name: string): { events: DebateEvent[] } =>
  JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'))
const manifest: SnapshotManifest = JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8'))

test('a recorded verdict run reduces and renders: layers, gate results, verdict', () => {
  const { events } = loadFixture('verdict-run.json')
  const state = events.reduce(debateReducer, initialState)

  render(
    <main>
      <LayerFeed state={state} />
      <VerdictPanel state={state} {...noOutcome} />
    </main>,
  )

  expect(screen.getAllByText('Fundamentals').length).toBeGreaterThan(0)
  // this frozen fixture: sentiment gated out, verdict BEAR, N=2
  expect(screen.getByText('ABSTAINED · NO VOTE')).toBeTruthy()
  expect(screen.getByText('BEAR')).toBeTruthy()
  expect(screen.getByText('N=2')).toBeTruthy()
  // structural invariants that hold for ANY verdict run, whatever the model said:
  // conviction is never shown without N and dissent
  expect(screen.getByText('CONVICTION')).toBeTruthy()
  expect(screen.getByText('DISSENT')).toBeTruthy()
  // outcome absent from the DOM until explicitly revealed
  expect(screen.queryByText(/what actually happened/)).toBeNull()
  expect(screen.getByText('▣ REVEAL THE OUTCOME')).toBeTruthy()
  // layer 04's ruling table renders a row per adjudication
  expect(screen.getByText('Judgment')).toBeTruthy()
  expect(screen.getAllByText('Complete').length).toBeGreaterThan(0)
})

test('the provenance manifest derives grounded ratio + voting lenses from state', () => {
  const { events } = loadFixture('verdict-run.json')
  const state = events.reduce(debateReducer, initialState)

  render(<Provenance state={state} ticker="NVDA" asOf="2026-07-02" />)

  // specialist grounding across the three lanes: 2 + 0 + 4 = 6 grounded of 7 cited
  expect(screen.getByText('6')).toBeTruthy()
  expect(screen.getByText('/ 7')).toBeTruthy()
  // the sealed outcome is never named in the provenance readout
  expect(screen.queryByText(/what actually happened/)).toBeNull()
  expect(screen.getByText('NVDA')).toBeTruthy()
})

test('an error-terminated recorded run still renders the layer feed without crashing', () => {
  const { events } = loadFixture('error-run.json')
  const state = events.reduce(debateReducer, initialState)
  expect(state.phase).toBe('error')
  const { unmount } = render(
    <main>
      <LayerFeed state={state} />
    </main>,
  )
  // layer 01 (theses) rendered before the error still shows
  expect(screen.getByText('Fundamentals')).toBeTruthy()
  expect(screen.getByText('Theses')).toBeTruthy()
  // sentiment gated out before red-team ever attacked it — layer 02 shows only
  // its "stands down" card, no red-team tool activity, no rulings table
  expect(screen.getByText('STANDS DOWN')).toBeTruthy()
  expect(screen.queryByText('Judgment')).toBeNull()
  unmount()
})

test('the provenance strip renders manifest chips from a fixture manifest', () => {
  const { events } = loadFixture('verdict-run.json')
  const state = events.reduce(debateReducer, initialState)

  render(<Provenance state={state} ticker="NVDA" asOf="2026-07-02" manifest={manifest} />)

  // identity flips to "frozen {as_of}" once a manifest has loaded
  expect(screen.getByText(/frozen 2026-07-02/)).toBeTruthy()
  expect(screen.getByText(/Prices — 250d EOD/)).toBeTruthy()
  expect(screen.getByText(/Fundamentals — 2026-04-30 \(10-Q\)/)).toBeTruthy()
  expect(screen.getByText(/News — 2 sources/)).toBeTruthy()
  // no leak violations in the fixture ⇒ the green "0 sources post-date as-of" chip
  expect(screen.getByText(/0 sources post-date as-of/)).toBeTruthy()
  expect(screen.getByText(/VIEW MANIFEST/)).toBeTruthy()
})

test('the manifest toggle expands fundamentals/technicals keys and news links', () => {
  const { events } = loadFixture('verdict-run.json')
  const state = events.reduce(debateReducer, initialState)

  render(<Provenance state={state} ticker="NVDA" asOf="2026-07-02" manifest={manifest} />)

  fireEvent.click(screen.getByText(/VIEW MANIFEST/))

  expect(screen.getByText('income_stmt.Normalized EBITDA')).toBeTruthy()
  expect(screen.getByText('technicals.return_1m')).toBeTruthy()
  expect(screen.getByText('NVIDIA shares slide amid broader chip sector pullback')).toBeTruthy()
})

test('EvidenceRow shows the snapshot value + a source link when the manifest resolves the citation key', () => {
  render(
    <EvidenceList
      evidence={[{
        kind: 'numeric',
        claim: 'The return over the past month is -0.124598',
        citation_key: 'technicals.return_1m',
        cited_value: -0.124598,
        grounded: true,
      }]}
      manifest={manifest}
    />,
  )

  // expand the row to reveal the cross-check
  fireEvent.click(screen.getByRole('button', { expanded: false }))

  expect(screen.getByText('snapshot')).toBeTruthy()
  const link = screen.getByText('↗ open source') as HTMLAnchorElement
  expect(link.getAttribute('href')).toBe('https://finance.yahoo.com/quote/NVDA/history')
})

// The red-team activity strip moved into layer 02's card (#14) — reduce a
// duration_s-bearing tool loop through the real LayerFeed and check the
// stamp (#13) renders in its new home.
test('layer 02 renders a duration stamp when tool_result carries duration_s', () => {
  const state = [
    { type: 'agent_start', agent: 'red_team' },
    { type: 'tool_call', agent: 'red_team', tool: 'get_financials', args: {} },
    { type: 'tool_result', agent: 'red_team', tool: 'get_financials', data: {}, duration_s: 0.6 },
  ].reduce(debateReducer, initialState)

  render(<LayerFeed state={state} />)

  expect(screen.getByText(/✓ 0\.6s/)).toBeTruthy()
})

test('layer 02 falls back to a bare check on older recordings without duration_s', () => {
  const state = [
    { type: 'agent_start', agent: 'red_team' },
    { type: 'tool_call', agent: 'red_team', tool: 'get_news', args: {} },
    { type: 'tool_result', agent: 'red_team', tool: 'get_news', data: [] }, // no duration_s
  ].reduce(debateReducer, initialState)

  render(<LayerFeed state={state} />)

  expect(screen.getByText(/⚙ get_news ✓/)).toBeTruthy()
  expect(screen.queryByText(/✓ .*s$/)).toBeNull()
})

test('EvidenceRow does not crash on a comma-separated bad citation_key and simply shows no cross-check', () => {
  render(
    <EvidenceList
      evidence={[{
        kind: 'numeric',
        claim: 'The price is below both 20-day and 50-day SMAs',
        citation_key: 'technicals.pct_vs_sma_20, technicals.pct_vs_sma_50',
        cited_value: -0.042534,
        grounded: false,
        reason: 'citation_key not in snapshot',
      }]}
      manifest={manifest}
    />,
  )

  fireEvent.click(screen.getByRole('button', { expanded: false }))
  expect(screen.queryByText('snapshot')).toBeNull()
})
