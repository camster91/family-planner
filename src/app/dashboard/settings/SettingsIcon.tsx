import type { LucideIcon } from 'lucide-react'

// Full class strings so Tailwind keeps them.
const TONES = {
  blue: 'bg-tint-budget text-white',
  yellow: 'bg-tint-meals text-white',
  purple: 'bg-tint-family text-white',
  violet: 'bg-chore text-white',
  sky: 'bg-tint-calendar text-white',
  emerald: 'bg-tint-lists text-white',
  green: 'bg-tint-lists text-white',
  red: 'bg-tint-messages text-white',
  teal: 'bg-tint-projects text-white',
} as const

/** The small tinted icon tile at the start of each Settings card. Decorative. */
export default function SettingsIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: keyof typeof TONES }) {
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`} aria-hidden="true">
      <Icon className="h-5 w-5" />
    </span>
  )
}
