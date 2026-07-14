import { useEffect, useMemo, useRef, useState } from 'react'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'

// Local YYYY-MM-DD, matching the as-of keys on disk. Deliberately NOT toISOString()
// (that shifts to UTC and can land on the wrong calendar day west of GMT).
const toKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromKey = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

interface Props {
  value: string // selected as-of (YYYY-MM-DD), '' when none
  enabled: string[] // the only selectable dates — those with a run to show
  onChange: (asOf: string) => void
  disabled?: boolean // whole control locked (e.g. mid-run)
}

/** As-of picker: a month calendar where only `enabled` dates are clickable and every
 *  other day is greyed out. Opens in a click-outside-dismiss popover. */
export function DatePicker({ value, enabled, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const enabledSet = useMemo(() => new Set(enabled), [enabled])
  const selected = value ? fromKey(value) : undefined
  // sorted ascending: bound month-nav to the data range and open on the newest month
  const sorted = useMemo(() => [...enabled].sort(), [enabled])
  const first = sorted.length ? fromKey(sorted[0]) : undefined
  const last = sorted.length ? fromKey(sorted[sorted.length - 1]) : undefined

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="as-of date"
        className="flex w-40 items-center justify-between rounded-[9px] border border-hairline bg-surface px-3 py-2 font-mono text-[13px] text-ink outline-none transition-colors hover:border-judge disabled:opacity-40"
      >
        <span className={value ? '' : 'text-ink-3'}>{value || 'as-of…'}</span>
        <span className="text-[11px] text-ink-3">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 rounded-[12px] border border-hairline bg-raised p-2 shadow-2xl">
          <DayPicker
            className="swarm-daypicker"
            mode="single"
            selected={selected}
            defaultMonth={selected ?? last}
            startMonth={first}
            endMonth={last}
            disabled={(d) => !enabledSet.has(toKey(d))}
            onSelect={(d) => {
              if (!d) return
              onChange(toKey(d))
              setOpen(false)
            }}
          />
        </div>
      )}
    </div>
  )
}
