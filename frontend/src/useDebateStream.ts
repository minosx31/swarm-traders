import { useCallback, useReducer, useRef } from 'react'
import { loadRunEvents, STATIC, streamUrl, type StreamOpts } from './api'
import { debateReducer, initialState, type DebateState } from './reducer'
import type { DebateEvent } from './types'

// client-side replay pacing (mirrors backend EVENT_DELAY_S); Vite-overridable
const STATIC_DELAY_MS = Number(import.meta.env.VITE_EVENT_DELAY_MS ?? 250)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
          dispatch(event)
          if (event.type === 'verdict' || event.type === 'error') return
          await sleep(STATIC_DELAY_MS)
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
