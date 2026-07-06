import { useEffect, useMemo, useState } from 'react'
import { ensureSnapshot, fetchModels, fetchRuns, fetchWhitelist, STATIC } from './api'
import { AgentChip } from './components'
import { Lane } from './Lane'
import { Provenance } from './Provenance'
import { useDebateStream } from './useDebateStream'
import { VerdictPanel } from './VerdictPanel'
import { SPECIALISTS, type ModelOption, type RunOption, type WhitelistPair } from './types'

type Mode = 'live' | 'replay'

// 20260704T031559Z -> "07-04 03:15" for the replay run picker
function fmtStamp(s: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(s)
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : s
}

export default function App() {
  const { state, start } = useDebateStream()
  const [whitelist, setWhitelist] = useState<WhitelistPair[]>([])
  const [ticker, setTicker] = useState('')
  const [asOf, setAsOf] = useState('')
  const [mode, setMode] = useState<Mode>(STATIC ? 'replay' : 'live') // static site is replay-only
  const [newPair, setNewPair] = useState(false)
  const [building, setBuilding] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [models, setModels] = useState<ModelOption[]>([])
  const [sel, setSel] = useState('') // selected "backend::model"
  const [runs, setRuns] = useState<RunOption[]>([])
  const [selRun, setSelRun] = useState('') // selected recorded-run filename (replay)
  const [pendingPaid, setPendingPaid] = useState(false)

  const replay = mode === 'replay'
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

  // replay: list recorded runs for the chosen pair so one can be picked by model
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

  const pickMode = (m: Mode) => {
    setMode(m)
    if (m === 'replay') {
      // replay can only re-stream recorded pairs — leave the free-text escape hatch
      setNewPair(false)
      if (!whitelisted && whitelist.length > 0) {
        const last = whitelist[whitelist.length - 1]
        setTicker(last.ticker)
        setAsOf(last.as_of)
      }
    }
  }

  const launch = async () => {
    setRefusal(null)
    setPendingPaid(false)
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

  const streaming = state.phase === 'streaming'
  const fieldCls =
    'appearance-none rounded-md border border-hairline bg-surface py-1.5 pl-2.5 pr-7 text-[14px] text-ink outline-none transition-colors focus:border-judge disabled:opacity-40'

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <h1 className="font-display text-2xl italic leading-none">
            Swarm Traders<span className="text-judge">.</span>
          </h1>
          <p className="mt-1 text-[12px] tracking-[0.24em] text-ink-3">
            THE RESEARCH ANALYST THAT NEVER SKIPS THE BEAR CASE
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* mode: LIVE convenes the swarm (building if needed) · REPLAY re-streams a recorded run.
              The static site is replay-only, so the toggle collapses to a badge. */}
          {STATIC ? (
            <span className="rounded-md border border-hairline px-3.5 py-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3">
              REPLAY ARCHIVE
            </span>
          ) : (
            <div className="inline-flex overflow-hidden rounded-md border border-hairline">
              {(['live', 'replay'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => pickMode(m)}
                  disabled={streaming || building}
                  className={`seg-active flex cursor-pointer items-center gap-2 px-3.5 py-2 text-[11px] font-semibold tracking-[0.14em] disabled:cursor-default ${
                    mode === m ? 'bg-judge/15 text-judge' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {m === 'live' && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full bg-judge ${mode === 'live' ? 'live-dot' : 'opacity-40'}`}
                      style={mode === 'live' ? { boxShadow: '0 0 8px var(--color-judge)' } : undefined}
                    />
                  )}
                  {m === 'live' ? 'LIVE' : 'REPLAY'}
                </button>
              ))}
            </div>
          )}

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
            className="min-w-[200px] cursor-pointer rounded-md border border-judge bg-judge/5 px-4 py-1.5 text-[13px] font-semibold tracking-[0.2em] text-judge transition-colors hover:bg-judge hover:text-page disabled:cursor-default disabled:opacity-40"
          >
            {building ? 'BUILDING SNAPSHOT…'
              : streaming ? 'IN SESSION…'
              : replay ? '▶ REPLAY RUN' : '▶ START ANALYSIS'}
          </button>
        </div>
      </header>

      {refusal && (
        <div className="border-b border-bear/40 bg-bear/10 px-5 py-2 text-[13px] text-bear">
          400 · {refusal}
        </div>
      )}
      {pendingPaid && selected?.paid && (
        <div className="flex flex-wrap items-center gap-3 border-b border-technicals/40 bg-technicals/10 px-5 py-2 text-[13px] text-technicals">
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
        <div className="border-b border-bear/40 bg-bear/10 px-5 py-2 text-[13px] text-bear">
          RUN ENDED — {state.error.error}: {state.error.message}
        </div>
      )}

      <Provenance state={state} ticker={ticker.toUpperCase()} asOf={asOf} replay={replay} />

      {state.redTeam.toolActivity.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-redteam/30 bg-redteam/5 px-5 py-1.5 text-[12px] text-redteam">
          <span className="font-semibold tracking-[0.2em]">RED-TEAM GATHERING</span>
          {state.redTeam.toolActivity.map((t, i) => (
            <span key={i} className="tnum">
              ⚙ {t.tool}
              {t.type === 'tool_result' ? ' ✓' : '…'}
            </span>
          ))}
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 gap-px bg-hairline md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_360px]">
        {SPECIALISTS.map((agent) => (
          <Lane key={agent} agent={agent} lane={state.lanes[agent]} />
        ))}
        <VerdictPanel state={state} ticker={ticker.toUpperCase()} asOf={asOf} />
      </main>

      <footer className="flex items-center justify-between border-t border-hairline px-5 py-2 text-[12px] tracking-widest text-ink-3">
        <span className="flex items-center gap-3">
          <AgentChip agent="red_team" thinking={state.redTeam.status === 'thinking'} />
          <AgentChip agent="judge" thinking={state.judgeActive && state.phase === 'streaming'} />
        </span>
        <span className="tnum">
          {state.eventCount} EVENTS · POINT-IN-TIME DATA ≤ AS-OF · OUTCOME HELD OUT
        </span>
      </footer>
    </div>
  )
}
