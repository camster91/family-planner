"use client"
import { WEEKDAYS } from '@/lib/chore-weekdays'

export function WeeklyDaysPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  return <fieldset className="space-y-2">
    <legend className="label-apple">Repeat on</legend>
    <p className="text-footnote text-label-secondary">Choose one or more days each week.</p>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {WEEKDAYS.map(({day,label}) => <label key={day} className="flex items-center gap-2 min-h-[44px] rounded-lg bg-[var(--surface-fill)] px-3 py-2 text-label-primary">
        <input type="checkbox" checked={days.includes(day)} onChange={() => onChange(days.includes(day) ? days.filter(d => d !== day) : [...days,day].sort((a,b) => a-b))} />
        <span className="min-w-0 break-words">{label}</span>
      </label>)}
    </div>
  </fieldset>
}
