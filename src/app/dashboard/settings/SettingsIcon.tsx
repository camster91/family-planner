import type { LucideIcon } from 'lucide-react'

// Full class strings so Tailwind keeps them.
const TONES = {
  blue: 'bg-blue-100 text-blue-600',
  yellow: 'bg-yellow-100 text-yellow-700',
  purple: 'bg-purple-100 text-purple-600',
  violet: 'bg-violet-100 text-violet-600',
  sky: 'bg-sky-100 text-sky-600',
  emerald: 'bg-emerald-100 text-emerald-700',
  green: 'bg-green-100 text-green-600',
  red: 'bg-red-100 text-red-600',
  teal: 'bg-teal-100 text-teal-700',
} as const

/** The small tinted icon tile at the start of each Settings card. Decorative. */
export default function SettingsIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: keyof typeof TONES }) {
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`} aria-hidden="true">
      <Icon className="h-5 w-5" />
    </span>
  )
}
