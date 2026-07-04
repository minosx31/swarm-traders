import type { Outcome, WhitelistPair } from './types'

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'

export function streamUrl(ticker: string, asOf: string, replay: boolean): string {
  const params = new URLSearchParams({ ticker, as_of: asOf })
  if (replay) params.set('replay', '1')
  return `${API_BASE}/stream?${params}`
}

export async function fetchWhitelist(): Promise<WhitelistPair[]> {
  const res = await fetch(`${API_BASE}/whitelist`)
  if (!res.ok) throw new Error(`whitelist fetch failed: ${res.status}`)
  return res.json()
}

/** Fetched only after the Verdict — the Outcome never rides the stream (ADR 0002). */
export async function fetchOutcome(ticker: string, asOf: string): Promise<Outcome> {
  const res = await fetch(`${API_BASE}/outcome?ticker=${ticker}&as_of=${asOf}`)
  if (!res.ok) throw new Error(`no outcome available (${res.status})`)
  return res.json()
}
