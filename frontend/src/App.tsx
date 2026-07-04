import { useEffect, useMemo, useState } from 'react'
import { ensureSnapshot, fetchWhitelist } from './api'
import { AgentChip } from './components'
import { Lane } from './Lane'
import { useDebateStream } from './useDebateStream'
import { VerdictPanel } from './VerdictPanel'
import { SPECIALISTS, type WhitelistPair } from './types'

export default function App() {
  const { state, start } = useDebateStream()
  const [whitelist, setWhitelist] = useState<WhitelistPair[]>([])
  const [ticker, setTicker] = useState('')
  const [asOf, setAsOf] = useState('')
  const [replay, setReplay] = useState(false)
  const [building, setBuilding] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    fetchWhitelist().then((pairs) => {
      setWhitelist(pairs)
      if (pairs.length > 0) {
        setTicker(pairs[pairs.length - 1].ticker)
        setAsOf(pairs[pairs.length - 1].as_of)
      }
    }, () => setRefusal('backend unreachable — start uvicorn on :8000'))
  }, [])

  const whitelisted = useMemo(
    () => whitelist.some((p) => p.ticker === ticker.toUpperCase() && p.as_of === asOf),
    [whitelist, ticker, asOf],
  )

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

  return (
    <div className="atmosphere flex min-h-screen flex-col bg-page">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline px-5 py-4">
        <div>
          <h1 className="font-display text-2xl italic leading-none">
            Alpha Swarms<span className="text-judge">.</span>
          </h1>
          <p className="mt-1 text-[10px] tracking-[0.24em] text-ink-3">
            THE RESEARCH ANALYST THAT NEVER SKIPS THE BEAR CASE
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] tracking-widest text-ink-3">
            TICKER
            <input
              className="w-20 border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink uppercase outline-none focus:border-judge"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              list="whitelist-tickers"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[10px] tracking-widest text-ink-3">
            AS-OF
            <input
              className="w-32 border border-hairline bg-surface px-2 py-1.5 text-[12px] text-ink outline-none focus:border-judge"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              placeholder="YYYY-MM-DD"
              list="whitelist-dates"
            />
          </label>
          <datalist id="whitelist-tickers">
            {[...new Set(whitelist.map((p) => p.ticker))].map((t) => <option key={t} value={t} />)}
          </datalist>
          <datalist id="whitelist-dates">
            {whitelist.filter((p) => p.ticker === ticker.toUpperCase()).map((p) => (
              <option key={p.as_of} value={p.as_of} />
            ))}
          </datalist>
          <label className="flex cursor-pointer items-center gap-1.5 text-[10px] tracking-widest text-ink-3">
            <input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)}
                   className="accent-(--color-judge)" />
            REPLAY
          </label>
          <button
            onClick={run}
            disabled={state.phase === 'streaming' || building}
            className="cursor-pointer border border-judge px-4 py-1.5 text-[11px] font-semibold tracking-[0.2em] text-judge transition-colors hover:bg-judge hover:text-page disabled:cursor-default disabled:opacity-40"
          >
            {building ? 'BUILDING SNAPSHOT…'
              : state.phase === 'streaming' ? 'IN SESSION…'
              : replay ? '▶ REPLAY RUN' : '▶ CONVENE SWARM'}
          </button>
        </div>
      </header>

      {refusal && (
        <div className="border-b border-bear/40 bg-bear/10 px-5 py-2 text-[11.5px] text-bear">
          400 · {refusal}
        </div>
      )}
      {state.error && (
        <div className="border-b border-bear/40 bg-bear/10 px-5 py-2 text-[11.5px] text-bear">
          RUN ENDED — {state.error.error}: {state.error.message}
        </div>
      )}

      {state.redTeam.toolActivity.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-redteam/30 bg-redteam/5 px-5 py-1.5 text-[10.5px] text-redteam">
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

      <footer className="flex items-center justify-between border-t border-hairline px-5 py-2 text-[10px] tracking-widest text-ink-3">
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
