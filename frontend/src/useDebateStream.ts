import { useCallback, useReducer, useRef } from 'react'
import { loadRunEvents, STATIC, streamUrl, type StreamOpts } from './api'
import { debateReducer, initialState, type DebateState } from './reducer'
import type { DebateEvent } from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Client-side replay pacing. A live run feels alive because real LLM latency
// spaces the events; replay has none, so a flat delay dumps everything at once.
// Two mechanisms give it back that texture:
//   • structural / tool events dwell before dispatch for a beat sized to what they
//     represent (a tool result uses its recorded runtime), with jitter.
//   • prose (thesis / attack / rebuttal / adjudication) streams in word by word,
//     the way live token output arrives, instead of the whole block popping in.
// VITE_EVENT_DELAY_MS (the base beat, ~125ms) scales the whole timeline: lower ⇒
// snappier, higher ⇒ slower / more deliberate. The old flat 250ms dumped a run in
// ~7s; this keeps the bundled runs realistic but demo-safe.
const BASE_MS = Number(import.meta.env.VITE_EVENT_DELAY_MS ?? 125)
const UNIT = BASE_MS / 250 // 1 at the default; scales every beat together

// Dwell before a non-prose event. Prose events use a short lead-in (below) and
// then earn their time by streaming, so they're excluded here.
function eventDelay(event: DebateEvent): number {
  const jitter = 0.8 + Math.random() * 0.4 // ±20%, so pacing isn't mechanical
  let ms: number
  switch (event.type) {
    case 'agent_start': ms = 450; break // the agent takes the floor
    case 'tool_call': ms = 350; break // deciding to reach for a tool
    case 'tool_result': // the tool actually running — use its recorded runtime
      ms = event.duration_s != null ? Math.min(Math.max(event.duration_s * 1000, 300), 2500) : 700
      break
    case 'grounding': ms = 300; break
    case 'verdict': ms = 1300; break // a beat of suspense before the finale
    default: ms = 250
  }
  return ms * UNIT * jitter
}

// The prose field a text event streams, plus the structured field to hold back
// until the prose finishes — so a thesis's citations land after the sentence that
// earns them, the way a live run reads, instead of all at once up front.
type TextPlan = { key: string; text: string; defer?: string }
function textPlan(event: DebateEvent): TextPlan | null {
  switch (event.type) {
    case 'thesis': return { key: 'summary', text: event.summary, defer: 'evidence' }
    case 'attack': return { key: 'critique', text: event.critique, defer: 'counter_evidence' }
    case 'rebuttal': return { key: 'response', text: event.response }
    case 'adjudication': return event.rationale ? { key: 'rationale', text: event.rationale } : null
    default: return null
  }
}

const LEAD_IN_MS = 380 // pause before the agent starts speaking, then prose streams

// How long to dwell after emitting a word: longer words take a beat longer, and a
// sentence- or clause-ending mark pauses like a speaker drawing breath — with
// jitter so it never reads metronomic.
function wordBeat(word: string): number {
  const w = word.trim()
  const jitter = 0.75 + Math.random() * 0.5 // ±25%
  const pause = /[.!?…]["')\]]?$/.test(w) ? 240 : /[,;:]$/.test(w) ? 90 : 0
  return ((38 + w.length * 7) * jitter + pause) * UNIT
}

interface StreamControls {
  state: DebateState
  connecting: boolean
  start: (ticker: string, asOf: string, replay: boolean, opts?: StreamOpts) => void
  reset: () => void
}

// Streaming meta-actions. A prose event arrives as many '__partial__' frames (one
// per word) that fold content in place but must NOT bump eventCount — the run's
// event total shouldn't inflate with per-word frames — followed by one '__commit__'
// that counts it once. Everything else dispatches as a plain event.
type StreamAction =
  | DebateEvent
  | { type: '__reset__' }
  | { type: '__connecting__' }
  | { type: '__partial__'; event: DebateEvent; first: boolean }
  | { type: '__commit__' }

function applyPartial(s: DebateState, event: DebateEvent, first: boolean): DebateState {
  // attack folds by appending to a list, so a mid-stream frame must replace the
  // last (in-progress) attack rather than append a fresh one each word; the first
  // frame appends to seed it. Prose events that fold by replacement need no such
  // care. Either way we discard the eventCount bump — __commit__ owns counting.
  if (event.type === 'attack' && !first) {
    const lane = s.lanes[event.target]
    if (lane && lane.attacks.length) {
      return {
        ...s,
        lanes: { ...s.lanes, [event.target]: {
          ...lane, attacks: [...lane.attacks.slice(0, -1), event],
        } },
      }
    }
  }
  return { ...debateReducer(s, event), eventCount: s.eventCount }
}

export function useDebateStream(): StreamControls {
  const [state, dispatch] = useReducer(
    (s: DebateState, action: StreamAction) =>
      action.type === '__reset__' ? initialState
        : action.type === '__connecting__' ? { ...s, phase: 'connecting' as const }
          : action.type === '__partial__' ? applyPartial(s, action.event, action.first)
            : action.type === '__commit__' ? { ...s, eventCount: s.eventCount + 1 }
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
          const plan = textPlan(event)
          if (plan) {
            // prose: a short lead-in, then stream it word by word like live output,
            // holding back structured evidence until the last word lands
            await sleep(LEAD_IN_MS * UNIT * (0.8 + Math.random() * 0.4))
            const words = plan.text.match(/\S+\s*/g) ?? [plan.text]
            const seed = plan.defer
              ? { ...event, [plan.key]: '', [plan.defer]: [] }
              : { ...event, [plan.key]: '' }
            let acc = ''
            for (let i = 0; i < words.length; i++) {
              if (token.cancelled) return
              acc += words[i]
              const last = i === words.length - 1
              // final frame carries the real event (full text + restored evidence)
              const frame = last ? event : { ...seed, [plan.key]: acc }
              dispatch({ type: '__partial__', event: frame, first: i === 0 })
              if (token.cancelled) return
              if (!last) await sleep(wordBeat(words[i]))
            }
            dispatch({ type: '__commit__' }) // count the completed event exactly once
          } else {
            await sleep(eventDelay(event)) // dwell as if this event were being produced
            if (token.cancelled) return
            dispatch(event)
          }
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
