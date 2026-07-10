import { useEffect, useMemo, useState } from 'react'
import { ensureSnapshot, fetchModels, fetchOutcome, fetchRuns, fetchSnapshotManifest, fetchWhitelist, STATIC } from './api'
import { AgentChip } from './components'
import { LayerFeed } from './Layers'
import { Orchestration } from './Orchestration'
import { Provenance } from './Provenance'
import { useDebateStream } from './useDebateStream'
import { VerdictFinale } from './VerdictFinale'
import { SPECIALISTS, type ModelOption, type Outcome, type RunOption, type SnapshotManifest, type WhitelistPair } from './types'

// 20260704T031559Z -> "07-04 03:15" for the cached-run picker
function fmtStamp(s: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(s)
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : s
}

export default function App() {
  const { state, start } = useDebateStream()
  const [whitelist, setWhitelist] = useState<WhitelistPair[]>([])
  const [ticker, setTicker] = useState('')
  const [asOf, setAsOf] = useState('')
  const [newPair, setNewPair] = useState(false)
  const [building, setBuilding] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [sel, setSel] = useState('') // selected "backend::model"
  const [runs, setRuns] = useState<RunOption[]>([])
  const [selRun, setSelRun] = useState('') // selected recorded-run filename (replay)
  const [pendingPaid, setPendingPaid] = useState(false)
  // the sealed Outcome — held in App so the verdict rail and the finale reveal as one
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [outcomeError, setOutcomeError] = useState<string | null>(null)
  // the point-in-time snapshot the swarm is fed — non-fatal if it fails to load
  const [manifest, setManifest] = useState<SnapshotManifest | null>(null)

  // The UI only ever presents "live". With a real backend that's a genuine live run;
  // in the bundled static demo (no backend) it transparently re-streams a cached run —
  // the "replay" plumbing is kept, just never surfaced to the user as a mode.
  const replay = STATIC
  const today = new Date().toISOString().slice(0, 10) // upper bound for a buildable as-of

  useEffect(() => {
    fetchWhitelist().then((pairs) => {
      setWhitelist(pairs)
      if (pairs.length > 0) {
        setTicker(pairs[pairs.length - 1].ticker)
        setAsOf(pairs[pairs.length - 1].as_of)
      }
    }, () => setRefusal(STATIC
      ? 'replay data not found — is public/data/index.json bundled? (bun run bundle)'
      : 'backend unreachable — start uvicorn on :8000'))
  }, [])

  useEffect(() => {
    fetchModels().then((ms) => {
      setModels(ms)
      const def = ms.find((m) => !m.paid) ?? ms[0] // default to a free local model
      if (def) setSel(`${def.backend}::${def.model}`)
    }, () => {})
  }, [])

  // static demo: list the cached runs for the chosen pair so one can be picked by model
  useEffect(() => {
    if (!replay || !ticker || !asOf) return
    fetchRuns(ticker.toUpperCase(), asOf).then((rs) => {
      setRuns(rs)
      setSelRun(rs.length > 0 ? rs[0].run : '') // newest first
    }, () => setRuns([]))
  }, [replay, ticker, asOf])

  // dropdown option spaces, derived from the whitelist (= snapshots on disk)
  const tickers = useMemo(
    () => [...new Set(whitelist.map((p) => p.ticker))].sort(),
    [whitelist],
  )
  const datesForTicker = useMemo(
    () => whitelist.filter((p) => p.ticker === ticker).map((p) => p.as_of).sort().reverse(),
    [whitelist, ticker],
  )
  const whitelisted = useMemo(
    () => whitelist.some((p) => p.ticker === ticker.toUpperCase() && p.as_of === asOf),
    [whitelist, ticker, asOf],
  )

  // the exact snapshot fed to the agents, for the Provenance manifest panel —
  // only fetched for a whitelisted pair; a failure just means it renders without it
  useEffect(() => {
    if (!whitelisted) {
      setManifest(null)
      return
    }
    const t = ticker.toUpperCase()
    fetchSnapshotManifest(t, asOf).then(setManifest, () => setManifest(null))
  }, [whitelisted, ticker, asOf])

  const selected = useMemo(
    () => models.find((m) => `${m.backend}::${m.model}` === sel),
    [models, sel],
  )

  const pickTicker = (t: string) => {
    setTicker(t)
    // snap as-of to that ticker's newest recorded date
    const dates = whitelist.filter((p) => p.ticker === t).map((p) => p.as_of).sort()
    if (dates.length > 0 && !dates.includes(asOf)) setAsOf(dates[dates.length - 1])
  }

  const launch = async () => {
    setRefusal(null)
    setPendingPaid(false)
    setOutcome(null) // a new run re-seals the outcome
    setOutcomeError(null)
    const t = ticker.toUpperCase()
    if (replay) {
      start(t, asOf, true, { run: selRun }) // the picked recording (by model), or latest
      return
    }
    if (!whitelisted) {
      // build the snapshot first (ADR 0006) — the debate only convenes once it exists
      setBuilding(true)
      try {
        await ensureSnapshot(t, asOf)
        setWhitelist(await fetchWhitelist())
      } catch (e) {
        setRefusal(e instanceof Error ? e.message : String(e))
        return
      } finally {
        setBuilding(false)
      }
    }
    start(t, asOf, false, { backend: selected?.backend, model: selected?.model })
  }

  // a paid (Claude) run is gated behind an explicit confirm; everything else launches directly
  const run = () => {
    if (!replay && selected?.paid) {
      setPendingPaid(true)
      return
    }
    launch()
  }

  const revealOutcome = () => {
    setOutcomeError(null)
    fetchOutcome(ticker.toUpperCase(), asOf).then(setOutcome, (e) =>
      setOutcomeError(String(e?.message ?? e)),
    )
  }

  const streaming = state.phase === 'streaming'
  // any specialist having taken the floor is enough to leave the pre-run empty state
  const feedStarted = SPECIALISTS.some(
    (s) => state.lanes[s].status !== 'idle' || state.lanes[s].thesis,
  )
  // the model behind this run — the recorded run's in replay, the picked one live
  const verdictModel = replay
    ? runs.find((r) => r.run === selRun)?.model
    : selected?.label
  const fieldCls =
    'appearance-none rounded-[9px] border border-hairline bg-surface py-2 pl-3 pr-8 font-mono text-[13px] text-ink outline-none transition-colors focus:border-judge disabled:opacity-40'

  return (
    <>
    <div className="atmosphere" aria-hidden />
    <div className="relative z-[1] flex min-h-screen flex-col">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-hairline px-[30px] pb-5 pt-[22px]">
        <div>
          <h1 className="font-display text-[31px] font-medium leading-none text-ink" style={{ letterSpacing: '-0.01em' }}>
            Swarm<span className="font-normal italic"> Traders</span>
          </h1>
          <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-ink-3">
            THE RESEARCH ANALYST THAT NEVER SKIPS THE BEAR CASE
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Always a live presentation. (Behind the scenes a backend-less demo
              re-streams a cached run, but that's never surfaced as a mode.) */}
          <span className="inline-flex items-center gap-2 rounded-[9px] border border-judge/35 bg-judge/10 px-3.5 py-2 text-[11px] font-semibold tracking-[0.14em] text-judge">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-judge" style={{ boxShadow: '0 0 8px var(--color-judge)' }} />
            LIVE
          </span>

          {newPair && !replay ? (
            // escape hatch: type a brand-new (ticker, as-of) to build a fresh snapshot
            <>
              <input
                className="w-20 rounded-md border border-hairline bg-surface px-2 py-1.5 text-[14px] uppercase text-ink outline-none focus:border-judge"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                placeholder="TICKER"
                aria-label="new ticker"
              />
              <input
                type="date"
                max={today}
                className="w-40 rounded-md border border-hairline bg-surface px-2 py-1.5 text-[14px] text-ink outline-none [color-scheme:dark] focus:border-judge"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                aria-label="new as-of date"
              />
              <button
                onClick={() => setNewPair(false)}
                className="cursor-pointer px-1 text-[16px] leading-none text-ink-3 hover:text-ink"
                title="back to recorded pairs"
              >
                ×
              </button>
            </>
          ) : (
            // dropdowns over the recorded snapshots
            <>
              <div className="relative">
                <select
                  className={`${fieldCls} w-24`}
                  value={tickers.includes(ticker) ? ticker : ''}
                  onChange={(e) => pickTicker(e.target.value)}
                  disabled={streaming || building || tickers.length === 0}
                  aria-label="ticker"
                >
                  {tickers.length === 0 && <option value="">—</option>}
                  {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">▾</span>
              </div>
              <div className="relative">
                <select
                  className={`${fieldCls} w-36`}
                  value={datesForTicker.includes(asOf) ? asOf : ''}
                  onChange={(e) => setAsOf(e.target.value)}
                  disabled={streaming || building || datesForTicker.length === 0}
                  aria-label="as-of date"
                >
                  {datesForTicker.length === 0 && <option value="">as-of…</option>}
                  {datesForTicker.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">▾</span>
              </div>
              {/* always rendered so its footprint is reserved — hidden but space-holding in replay, keeping the dropdowns from shifting on mode toggle */}
              <button
                onClick={() => setNewPair(true)}
                disabled={streaming || building || replay}
                aria-hidden={replay}
                tabIndex={replay ? -1 : undefined}
                className={`cursor-pointer rounded-md border border-dashed border-hairline px-2.5 py-1.5 text-[12px] font-semibold tracking-[0.14em] text-ink-3 transition-colors hover:border-judge hover:text-judge disabled:cursor-default disabled:opacity-40 ${replay ? 'invisible' : ''}`}
                title="build a new point-in-time snapshot"
              >
                ＋ NEW PAIR
              </button>
            </>
          )}

          {/* live: pick the model (Ollama / Claude) · replay: pick which recorded run, by model */}
          {replay ? (
            <div className="relative">
              <select
                className={`${fieldCls} w-56`}
                value={selRun}
                onChange={(e) => setSelRun(e.target.value)}
                disabled={streaming || building || runs.length === 0}
                aria-label="recorded run"
              >
                {runs.length === 0 && <option value="">no recorded runs</option>}
                {runs.map((r) => (
                  <option key={r.run} value={r.run}>{r.model} · {fmtStamp(r.recorded_at)}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">▾</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  className={`${fieldCls} w-56 ${selected?.paid ? 'text-technicals' : ''}`}
                  value={sel}
                  onChange={(e) => setSel(e.target.value)}
                  disabled={streaming || building || models.length === 0}
                  aria-label="model"
                >
                  {models.length === 0 && <option value="">no models found</option>}
                  {models.some((m) => !m.paid) && (
                    <optgroup label="Ollama · local · free">
                      {models.filter((m) => !m.paid).map((m) => (
                        <option key={`${m.backend}::${m.model}`} value={`${m.backend}::${m.model}`}>{m.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {models.some((m) => m.paid) && (
                    <optgroup label="Claude · paid · credits">
                      {models.filter((m) => m.paid).map((m) => (
                        <option key={`${m.backend}::${m.model}`} value={`${m.backend}::${m.model}`}>{m.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">▾</span>
              </div>
              {selected?.paid && (
                <span className="text-[11px] font-semibold tracking-[0.14em] text-technicals" title="uses real API credits">⚠ CREDITS</span>
              )}
            </div>
          )}

          <button
            onClick={run}
            disabled={streaming || building || !ticker || !asOf || (replay ? !selRun : !selected)}
            className="min-w-[200px] cursor-pointer rounded-[9px] border border-judge bg-judge/[0.08] px-[18px] py-[9px] text-[13px] font-semibold tracking-[0.14em] text-judge transition-colors hover:bg-judge hover:text-page disabled:cursor-default disabled:opacity-40"
          >
            {building ? 'BUILDING SNAPSHOT…'
              : streaming ? 'IN SESSION…'
              : '▶ START ANALYSIS'}
          </button>
        </div>
      </header>

      {refusal && (
        <div className="border-b border-bear/40 bg-bear/10 px-[30px] py-2 text-[13px] text-bear">
          400 · {refusal}
        </div>
      )}
      {pendingPaid && selected?.paid && (
        <div className="flex flex-wrap items-center gap-3 border-b border-technicals/40 bg-technicals/10 px-[30px] py-2 text-[13px] text-technicals">
          <span>⚠ {selected.label} uses real API credits (~$ per run).</span>
          <button
            onClick={() => setPendingPaid(false)}
            className="cursor-pointer rounded border border-hairline px-2.5 py-0.5 text-[12px] text-ink-2 transition-colors hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={launch}
            className="cursor-pointer rounded border border-technicals px-2.5 py-0.5 text-[12px] font-semibold text-technicals transition-colors hover:bg-technicals hover:text-page"
          >
            Run anyway ▸
          </button>
        </div>
      )}
      {state.error && (
        <div className="border-b border-bear/40 bg-bear/10 px-[30px] py-2 text-[13px] text-bear">
          RUN ENDED — {state.error.error}: {state.error.message}
        </div>
      )}

      <Provenance state={state} ticker={ticker.toUpperCase()} asOf={asOf} manifest={manifest} />

      <main className="mx-auto flex w-full max-w-[960px] flex-col gap-[22px] px-[30px] pb-10 pt-[26px]">
        <Orchestration state={state} />

        <div>
          <div className="mb-3.5 flex items-center gap-2.5">
            <span className="font-display text-[18px] italic text-ink-2">The Debate</span>
            <span className="h-px flex-1 bg-hairline" />
            <span className="font-mono text-[11px] text-ink-3">{state.eventCount} events</span>
          </div>

          {!feedStarted ? (
            <div className="rounded-[14px] border border-dashed border-hairline px-6 py-11 text-center">
              <div className="mb-2.5 text-[26px] text-judge/80">✦</div>
              <p className="font-display text-[18px] text-ink-2">
                Three specialists, a red-team, and a judge are standing by.
              </p>
              <p className="mt-2 text-[13px] text-ink-3">
                Press <b className="font-semibold text-judge">Start Analysis</b> to convene the swarm
                and watch each thesis get challenged live.
              </p>
            </div>
          ) : (
            <LayerFeed state={state} manifest={manifest} />
          )}
        </div>

        {state.verdict && (
          <VerdictFinale
            state={state}
            outcome={outcome}
            onReveal={revealOutcome}
            outcomeError={outcomeError}
            ticker={ticker.toUpperCase()}
            asOf={asOf}
            model={verdictModel}
          />
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-[30px] py-3 font-mono text-[11px] tracking-[0.1em] text-ink-3">
        <span className="flex items-center gap-3.5">
          <AgentChip agent="red_team" thinking={state.redTeam.status === 'thinking'} />
          <AgentChip agent="judge" thinking={state.judgeActive && state.phase === 'streaming'} />
        </span>
        <span className="tnum">
          {state.eventCount} EVENTS · POINT-IN-TIME DATA ≤ AS-OF · OUTCOME HELD OUT
        </span>
      </footer>
    </div>
    </>
  )
}
