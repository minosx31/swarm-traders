import { useCallback, useReducer, useRef } from 'react'
import { loadRunEvents, STATIC, streamUrl, type StreamOpts } from './api'
import { debateReducer, initialState, type DebateState } from './reducer'
import type { DebateEvent } from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Client-side replay pacing. A live run feels alive because real LLM latency
// spaces the events; replay has none, so a flat delay dumps everything at once.
// Instead we dwell before each event for a beat sized to what it represents —
// text events ~ their length (generation time), tool results ~ their recorded
// runtime, structural events a short beat — with jitter so it never feels
// metronomic. VITE_EVENT_DELAY_MS (the base beat, ~190ms) scales the whole
// timeline: lower ⇒ snappier demo, higher ⇒ slower/more deliberate. The default
// lands a typical ~30-event run around ~40s — realistic without dragging a live
// demo (the old flat 250ms dumped the same run in ~7s).
const BASE_MS = Number(import.meta.env.VITE_EVENT_DELAY_MS ?? 190)

function eventDelay(event: DebateEvent): number {
  const unit = BASE_MS / 250 // 1 at the default; scales every beat together
  const jitter = 0.8 + Math.random() * 0.4 // ±20%, so pacing isn't mechanical
  // a text block dwells as if it were being generated: floor + per-char, capped
  const textBeat = (text: string, floor: number, perChar: number, cap: number) =>
    Math.min(floor + text.length * perChar, cap)

  let ms: number
  switch (event.type) {
    case 'agent_start': ms = 450; break // the agent takes the floor
    case 'tool_call': ms = 350; break // deciding to reach for a tool
    case 'tool_result': // the tool actually running — use its recorded runtime
      ms = event.duration_s != null ? Math.min(Math.max(event.duration_s * 1000, 300), 2500) : 700
      break
    case 'grounding': ms = 300; break
    case 'thesis': ms = textBeat(event.summary, 700, 7, 3200); break
    case 'attack': ms = textBeat(event.critique, 700, 7, 3200); break
    case 'rebuttal': ms = textBeat(event.response, 600, 7, 3000); break
    case 'adjudication': ms = textBeat(event.rationale ?? '', 550, 6, 2400); break
    case 'verdict': ms = 1300; break // a beat of suspense before the finale
    default: ms = 250
  }
  return ms * unit * jitter
}

interface StreamControls {
  state: DebateState
  connecting: boolean
  start: (ticker: string, asOf: string, replay: boolean, opts?: StreamOpts) => void
  reset: () => void
}

export function useDebateStream(): StreamControls {
  const [state, dispatch] = useReducer(
    (s: DebateState, action: DebateEvent | { type: '__reset__' } | { type: '__connecting__' }) =>
      action.type === '__reset__' ? initialState
        : action.type === '__connecting__' ? { ...s, phase: 'connecting' as const }
          : debateReducer(s, action as DebateEvent),
    initialState,
  )
  const sourceRef = useRef<EventSource | null>(null)
  const playRef = useRef<{ cancelled: boolean } | null>(null) // static-mode player token

  const stop = () => {
    sourceRef.current?.close()
    sourceRef.current = null
    if (playRef.current) playRef.current.cancelled = true
    playRef.current = null
  }

  const reset = useCallback(() => {
    stop()
    dispatch({ type: '__reset__' })
  }, [])

  const start = useCallback((ticker: string, asOf: string, replay: boolean, opts?: StreamOpts) => {
    stop()
    dispatch({ type: '__reset__' })

    if (STATIC) {
      // no backend: play the bundled run JSON over the same reducer, client-side
      const token = { cancelled: false }
      playRef.current = token
      ;(async () => {
        let events: DebateEvent[]
        try {
          events = await loadRunEvents(opts?.run ?? '')
        } catch (e) {
          if (!token.cancelled) {
            dispatch({ type: 'error', error: 'LoadError',
              message: e instanceof Error ? e.message : String(e) })
          }
          return
        }
        for (const event of events) {
          if (token.cancelled) return
          await sleep(eventDelay(event)) // dwell as if this event were being produced
          if (token.cancelled) return
          dispatch(event)
          if (event.type === 'verdict' || event.type === 'error') return
        }
      })()
      return
    }

    const source = new EventSource(streamUrl(ticker, asOf, replay, opts))
    sourceRef.current = source
    // show activity immediately — the first SSE event (agent_start) trails the
    // connect + backend setup, and we don't want the UI to read as un-started.
    dispatch({ type: '__connecting__' })
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as DebateEvent
      dispatch(event)
      if (event.type === 'verdict' || event.type === 'error') {
        source.close() // terminal event: don't let EventSource auto-reconnect
        sourceRef.current = null
      }
    }
    source.onerror = () => {
      // fires on network failure or a non-200 (e.g. the 400 refusal)
      if (source.readyState === EventSource.CLOSED) {
        dispatch({
          type: 'error',
          error: 'ConnectionError',
          message: 'stream refused or dropped — is the pair whitelisted and the backend running?',
        })
        sourceRef.current = null
      }
    }
  }, [])

  return { state, connecting: false, start, reset }
}
