import { useEffect, useMemo, useState } from 'react'
import { ensureSnapshot, fetchModels, fetchOutcome, fetchRuns, fetchSnapshotManifest, fetchWhitelist, STATIC, validateTicker } from './api'
import { AgentChip } from './components'
import { DatePicker } from './DatePicker'
import { LayerFeed } from './Layers'
import { Orchestration } from './Orchestration'
import { Provenance } from './Provenance'
import { useDebateStream } from './useDebateStream'
import { VerdictFinale } from './VerdictFinale'
import { SPECIALISTS, type ModelOption, type Outcome, type RunOption, type SnapshotManifest, type TickerCheck, type WhitelistPair } from './types'

// 20260704T031559Z -> "07-04 03:15" for the cached-run picker
function fmtStamp(s: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(s)
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : s
}

// Mirror backend llm.model_tag(): the slug a recorded run stores for its model, so
// a recording can be matched back to a model-list entry (to pre-select its model).
const modelTag = (m: ModelOption): string =>
  m.backend === 'openrouter' ? m.model.replace(/[/:]/g, '-')
    : m.backend === 'ollama' ? m.model.replace(/:/g, '-')
      : m.backend // haiku | sonnet | groq → the backend name is the tag

export default function App() {
  const { state, start } = useDebateStream()
  const [whitelist, setWhitelist] = useState<WhitelistPair[]>([])
  const [ticker, setTicker] = useState('')
  const [asOf, setAsOf] = useState('')
  const [newPair, setNewPair] = useState(false) // live-only: build+record a brand-new pair
  const [building, setBuilding] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // NEW PAIR ticker existence check — null until the box is probed on blur
  const [tickerCheck, setTickerCheck] = useState<TickerCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [models, setModels] = useState<ModelOption[]>([])
  const [sel, setSel] = useState('') // selected "backend::model"
  const [runs, setRuns] = useState<RunOption[]>([])
  const [selRun, setSelRun] = useState('') // selected recorded-run filename (replay)
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

  // list the recorded runs for the chosen pair — the static demo picks one by model,
  // and it tells us which dates actually have a run to show.
  useEffect(() => {
    if (!ticker || !asOf) return
    fetchRuns(ticker.toUpperCase(), asOf).then((rs) => {
      setRuns(rs)
      setSelRun(rs.length > 0 ? rs[0].run : '') // newest first
    }, () => { setRuns([]) })
  }, [ticker, asOf])

  // Live mode: when the chosen pair already has a recording, default the model
  // dropdown to the model that run used (matched via its model tag). A pair with no
  // recording leaves the current pick untouched — so recording a fresh pair keeps
  // whatever model you selected. Static mode has no model dropdown, so skip it.
  useEffect(() => {
    if (STATIC || runs.length === 0 || models.length === 0) return
    const match = models.find((m) => modelTag(m) === runs[0].model)
    if (match) setSel(`${match.backend}::${match.model}`)
  }, [runs, models])

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

  // Replay picker options: resolve each recorded run's model tag back to its
  // catalog entry (label/paid) so it shows the same polished labels and styling
  // as the live picker. Unresolved tags fall back to the raw slug. The timestamp
  // is only appended when a pair has two runs of the same model.
  const runOptions = useMemo(() => {
    const items = runs.map((r) => {
      const m = models.find((o) => modelTag(o) === r.model)
      return {
        run: r.run,
        label: m?.label ?? r.model,
        paid: m?.paid ?? false,
        recorded_at: r.recorded_at,
      }
    })
    const seen = new Map<string, number>()
    for (const it of items) seen.set(it.label, (seen.get(it.label) ?? 0) + 1)
    return items.map((it) => ({
      ...it,
      display: (seen.get(it.label) ?? 0) > 1 ? `${it.label} · ${fmtStamp(it.recorded_at)}` : it.label,
    }))
  }, [runs, models])

  const pickTicker = (t: string) => {
    setTicker(t)
    // snap as-of to that ticker's newest recorded date
    const dates = whitelist.filter((p) => p.ticker === t).map((p) => p.as_of).sort()
    if (dates.length > 0 && !dates.includes(asOf)) setAsOf(dates[dates.length - 1])
  }

  // the static demo re-streams a recorded run; a real backend runs live.
  const doReplay = STATIC

  // probe a hand-typed ticker on blur so a bad symbol is caught before a build
  const runTickerCheck = async () => {
    const t = ticker.trim().toUpperCase()
    if (!t) { setTickerCheck(null); return }
    setChecking(true)
    try { setTickerCheck(await validateTicker(t)) }
    catch { setTickerCheck(null) } // probe unreachable ⇒ don't block; build still gates
    finally { setChecking(false) }
  }

  const launch = async () => {
    setRefusal(null)
    setOutcome(null) // a new run re-seals the outcome
    setOutcomeError(null)
    const t = ticker.toUpperCase()
    if (doReplay) {
      start(t, asOf, true, { run: selRun }) // static demo: the picked recording
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

  const revealOutcome = () => {
    setOutcomeError(null)
    fetchOutcome(ticker.toUpperCase(), asOf).then(setOutcome, (e) =>
      setOutcomeError(String(e?.message ?? e)),
    )
  }

  const streaming = state.phase === 'streaming'
  const connecting = state.phase === 'connecting'
  // a run is live from the moment the stream opens (connecting) through streaming —
  // both must lock the controls and read as in-session, not idle
  const active = streaming || connecting
  // any specialist having taken the floor is enough to leave the pre-run empty state
  const feedStarted = SPECIALISTS.some(
    (s) => state.lanes[s].status !== 'idle' || state.lanes[s].thesis,
  )
  // the model behind this run — the recorded run's when re-streaming, else the picked one
  const verdictModel = STATIC
    ? runOptions.find((o) => o.run === selRun)?.label
    : selected?.label
  const fieldCls =
    'appearance-none rounded-[9px] border border-hairline bg-surface py-2 pl-3 pr-8 font-mono text-[13px] text-ink outline-none transition-colors focus:border-judge disabled:opacity-40'

  return (
    <>
    <div className="atmosphere" aria-hidden />
    <div className="relative z-[1] flex min-h-screen flex-col">
      <header className="flex flex-col gap-4 border-b border-hairline px-[30px] pb-5 pt-[22px]">
        <div>
          <h1 className="font-display text-[31px] font-medium leading-none text-ink" style={{ letterSpacing: '-0.01em' }}>
            Swarm<span className="font-normal italic"> Traders</span>
          </h1>
          <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-ink-3">
            THE RESEARCH ANALYST THAT NEVER SKIPS THE BEAR CASE
          </p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2.5">
          {/* Always a live presentation. (Behind the scenes a backend-less demo
              re-streams a cached run, but that's never surfaced as a mode.) */}
          <span className="inline-flex items-center gap-2 rounded-[9px] border border-judge/35 bg-judge/10 px-3.5 py-2 text-[11px] font-semibold tracking-[0.14em] text-judge">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-judge" style={{ boxShadow: '0 0 8px var(--color-judge)' }} />
            LIVE
          </span>

          {/* Fixed footprint so toggling build-mode — or the async validity message
              appearing — never re-wraps the bar or shifts the model picker + start. */}
          <div className="flex w-[430px] shrink-0 items-center gap-2.5">
          {newPair && !replay ? (
            // live-only escape hatch: type a brand-new (ticker, as-of) to build + record it
            <>
              <input
                className="w-20 rounded-md border border-hairline bg-surface px-2 py-1.5 text-[14px] uppercase text-ink outline-none focus:border-judge"
                value={ticker}
                onChange={(e) => { setTicker(e.target.value); setTickerCheck(null) }}
                onBlur={runTickerCheck}
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
                title="back to the calendar"
              >
                ×
              </button>
              {/* reserved, truncating slot so validity feedback doesn't widen the cluster */}
              <span className="min-w-0 flex-1 truncate text-[11px]">
                {checking ? (
                  <span className="text-ink-3">checking…</span>
                ) : tickerCheck && tickerCheck.valid ? (
                  <span className="text-bull" title={tickerCheck.name ?? undefined}>
                    ✓ {tickerCheck.name ?? 'valid symbol'}
                  </span>
                ) : tickerCheck ? (
                  <span className="text-bear">✗ {tickerCheck.reason ?? 'unknown symbol'}</span>
                ) : null}
              </span>
            </>
          ) : (
            <>
              <div className="relative">
                <select
                  className={`${fieldCls} w-24`}
                  value={tickers.includes(ticker) ? ticker : ''}
                  onChange={(e) => pickTicker(e.target.value)}
                  disabled={active || building || tickers.length === 0}
                  aria-label="ticker"
                >
                  {tickers.length === 0 && <option value="">—</option>}
                  {tickers.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">▾</span>
              </div>
              {/* run-aware calendar: only dates that have a run to show for this ticker
                  are selectable; every other day is greyed out. */}
              <DatePicker
                value={asOf}
                enabled={datesForTicker}
                onChange={setAsOf}
                disabled={active || building || datesForTicker.length === 0}
              />
              {/* build a brand-new pair — live backend only (nothing to build in the static demo) */}
              {!replay && (
                <button
                  onClick={() => setNewPair(true)}
                  disabled={active || building}
                  className="shrink-0 cursor-pointer rounded-md border border-dashed border-hairline px-2.5 py-1.5 text-[12px] font-semibold tracking-[0.14em] text-ink-3 transition-colors hover:border-judge hover:text-judge disabled:cursor-default disabled:opacity-40"
                  title="build a new point-in-time snapshot"
                >
                  ＋ NEW
                </button>
              )}
            </>
          )}
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2.5">
          {replay ? (
            <div className="relative">
              <select
                className={`${fieldCls} w-56 ${runOptions.find((o) => o.run === selRun)?.paid ? 'text-technicals' : ''}`}
                value={selRun}
                onChange={(e) => setSelRun(e.target.value)}
                disabled={active || building || runs.length === 0}
                aria-label="recorded run"
              >
                {runs.length === 0 && <option value="">no recorded runs</option>}
                {runOptions.map((o) => (
                  <option key={o.run} value={o.run}>{o.display}</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">▾</span>
            </div>
          ) : (
            <div className="relative">
              <select
                className={`${fieldCls} w-56 ${selected?.paid ? 'text-technicals' : ''}`}
                value={sel}
                onChange={(e) => setSel(e.target.value)}
                disabled={active || building || models.length === 0}
                aria-label="model"
              >
                {models.length === 0 && <option value="">no models found</option>}
                {[...new Set(models.map((m) => m.group))].map((group) => (
                  <optgroup key={group} label={group}>
                    {models.filter((m) => m.group === group).map((m) => (
                      <option key={`${m.backend}::${m.model}`} value={`${m.backend}::${m.model}`}>{m.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">▾</span>
            </div>
          )}

          <button
            onClick={launch}
            disabled={active || building || !ticker || !asOf
              || (replay ? !selRun : !selected)
              || (newPair && tickerCheck !== null && !tickerCheck.valid)}
            className="min-w-[200px] cursor-pointer rounded-[9px] border border-judge bg-judge/[0.08] px-[18px] py-[9px] text-[13px] font-semibold tracking-[0.14em] text-judge transition-colors hover:bg-judge hover:text-page disabled:cursor-default disabled:opacity-40"
          >
            {building ? 'BUILDING SNAPSHOT…'
              : connecting ? 'CONVENING SWARM…'
              : streaming ? 'IN SESSION…'
              : '▶ START ANALYSIS'}
          </button>
          </div>
        </div>
      </header>

      {refusal && (
        <div className="border-b border-bear/40 bg-bear/10 px-[30px] py-2 text-[13px] text-bear">
          400 · {refusal}
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
            connecting ? (
              <div className="rounded-[14px] border border-dashed border-judge/40 px-6 py-11 text-center">
                <div className="mb-2.5 animate-pulse text-[26px] text-judge/80">✦</div>
                <p className="font-display text-[18px] text-ink-2">Convening the swarm…</p>
                <p className="mt-2 text-[13px] text-ink-3">
                  Specialists are reading the snapshot — the first thesis lands shortly.
                </p>
              </div>
            ) : (
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
            )
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
