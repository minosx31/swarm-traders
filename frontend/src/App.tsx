import { useEffect, useMemo, useState } from 'react'
import { ensureSnapshot, fetchWhitelist } from './api'
import { AgentChip } from './components'
import { Lane } from './Lane'
import { Provenance } from './Provenance'
import { useDebateStream } from './useDebateStream'
import { VerdictPanel } from './VerdictPanel'
import { SPECIALISTS, type WhitelistPair } from './types'

type Mode = 'live' | 'replay'

export default function App() {
  const { state, start } = useDebateStream()
  const [whitelist, setWhitelist] = useState<WhitelistPair[]>([])
  const [ticker, setTicker] = useState('')
  const [asOf, setAsOf] = useState('')
  const [mode, setMode] = useState<Mode>('live')
  const [newPair, setNewPair] = useState(false)
  const [building, setBuilding] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const replay = mode === 'replay'

  useEffect(() => {
    fetchWhitelist().then((pairs) => {
      setWhitelist(pairs)
      if (pairs.length > 0) {
        setTicker(pairs[pairs.length - 1].ticker)
        setAsOf(pairs[pairs.length - 1].as_of)
      }
    }, () => setRefusal('backend unreachable — start uvicorn on :8000'))
  }, [])

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

  const run = async () => {
    setRefusal(null)
    const t = ticker.toUpperCase()
    if (!whitelisted && !replay) {
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
    start(t, asOf, replay)
  }

  const streaming = state.phase === 'streaming'
  const fieldCls =
    'appearance-none border border-hairline bg-surface py-1.5 pl-2.5 pr-7 text-[14px] text-ink outline-none transition-colors focus:border-judge disabled:opacity-40'

  return (
    <div className="atmosphere flex min-h-screen flex-col bg-page">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-hairline px-5 py-4">
        <div>
          <h1 className="font-display text-2xl italic leading-none">
            Alpha Swarms<span className="text-judge">.</span>
          </h1>
          <p className="mt-1 text-[12px] tracking-[0.24em] text-ink-3">
            THE RESEARCH ANALYST THAT NEVER SKIPS THE BEAR CASE
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* mode: LIVE convenes the swarm (building if needed) · REPLAY re-streams a recorded run */}
          <div className="inline-flex overflow-hidden border border-hairline">
            {(['live', 'replay'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => pickMode(m)}
                disabled={streaming || building}
                className={`seg-active cursor-pointer px-3 py-1.5 text-[12px] font-semibold tracking-[0.18em] disabled:cursor-default ${
                  mode === m ? 'bg-judge text-page' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {m === 'live' ? 'LIVE' : 'REPLAY'}
              </button>
            ))}
          </div>

          {newPair && !replay ? (
            // escape hatch: type a brand-new (ticker, as-of) to build a fresh snapshot
            <>
              <input
                className="w-20 border border-hairline bg-surface px-2 py-1.5 text-[14px] uppercase text-ink outline-none focus:border-judge"
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                placeholder="TICKER"
                aria-label="new ticker"
              />
              <input
                className="w-32 border border-hairline bg-surface px-2 py-1.5 text-[14px] text-ink outline-none focus:border-judge"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                placeholder="YYYY-MM-DD"
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
              {!replay && (
                <button
                  onClick={() => setNewPair(true)}
                  disabled={streaming || building}
                  className="cursor-pointer border border-dashed border-hairline px-2.5 py-1.5 text-[12px] font-semibold tracking-[0.14em] text-ink-3 transition-colors hover:border-judge hover:text-judge disabled:cursor-default disabled:opacity-40"
                  title="build a new point-in-time snapshot"
                >
                  ＋ NEW PAIR
                </button>
              )}
            </>
          )}

          <button
            onClick={run}
            disabled={streaming || building || !ticker || !asOf}
            className="cursor-pointer border border-judge px-4 py-1.5 text-[13px] font-semibold tracking-[0.2em] text-judge transition-colors hover:bg-judge hover:text-page disabled:cursor-default disabled:opacity-40"
          >
            {building ? 'BUILDING SNAPSHOT…'
              : streaming ? 'IN SESSION…'
              : replay ? '▶ REPLAY RUN' : '▶ CONVENE SWARM'}
          </button>
        </div>
      </header>

      {refusal && (
        <div className="border-b border-bear/40 bg-bear/10 px-5 py-2 text-[13px] text-bear">
          400 · {refusal}
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

      <main className="grid flex-1 grid-cols-1 gap-px bg-hairline md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_340px]">
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
