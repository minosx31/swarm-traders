import { useCallback, useReducer, useRef } from 'react'
import { streamUrl } from './api'
import { debateReducer, initialState, type DebateState } from './reducer'
import type { DebateEvent } from './types'

interface StreamControls {
  state: DebateState
  connecting: boolean
  start: (ticker: string, asOf: string, replay: boolean) => void
  reset: () => void
}

export function useDebateStream(): StreamControls {
  const [state, dispatch] = useReducer(
    (s: DebateState, action: DebateEvent | { type: '__reset__' }) =>
      action.type === '__reset__' ? initialState : debateReducer(s, action as DebateEvent),
    initialState,
  )
  const sourceRef = useRef<EventSource | null>(null)

  const reset = useCallback(() => {
    sourceRef.current?.close()
    sourceRef.current = null
    dispatch({ type: '__reset__' })
  }, [])

  const start = useCallback((ticker: string, asOf: string, replay: boolean) => {
    sourceRef.current?.close()
    dispatch({ type: '__reset__' })
    const source = new EventSource(streamUrl(ticker, asOf, replay))
    sourceRef.current = source
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
