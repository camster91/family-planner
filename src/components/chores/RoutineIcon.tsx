import * as React from 'react'
import { cn } from '@/lib/utils'
import { isRoutineIconKey, routineIconLabel, type RoutineIconKey } from '@/lib/routine-icons'

/**
 * Chore picture icons (#272). Original line art drawn for Family Planner, not
 * copied from any icon pack. One grammar for every picture so a routine reads
 * as one set (design/GRAPHICS.md "Chore picture icons"):
 *
 * - 24 × 24 grid, content inside 2–22, strokes only (no fills), `currentColor`;
 * - 2px stroke, round caps and joins (scales cleanly from 20px rows to 96px cards);
 * - one clear object per picture, no text, no faces beyond a simple smile,
 *   nothing holiday- or culture-specific.
 *
 * The keys and labels live in `src/lib/routine-icons.ts` (the API validates
 * against them). Every key there must have a drawing here (tested).
 */

const dot = (x: number, y: number) => `M${x} ${y}h.01`

const DRAWINGS: Record<RoutineIconKey, React.ReactNode> = {
  'wake-up': (
    <>
      <path d="M3 18h18" />
      <path d="M7 18a5 5 0 0 1 10 0" />
      <path d="M12 7v2.5M5.8 10.8l1.6 1.6M18.2 10.8l-1.6 1.6M2.5 14.5H4.5M19.5 14.5h2" />
      <path d="M8 21.5h8" />
    </>
  ),
  toilet: (
    <>
      <rect x="5" y="2.5" width="7" height="8.5" rx="1" />
      <path d="M3.5 11h17v1a6 6 0 0 1-6 6h-5a6 6 0 0 1-6-6z" />
      <path d="M9 18l-1 3.5h8l-1-3.5" />
    </>
  ),
  'wash-hands': (
    <>
      <path d="M3 6.5h9a4 4 0 0 1 4 4V12" />
      <path d="M7.5 6.5V3.5M5.5 3.5h4" />
      <path d="M16 15c-.9 1.2-1.4 2-1.4 2.6a1.4 1.4 0 0 0 2.8 0c0-.6-.5-1.4-1.4-2.6z" />
      <circle cx="6" cy="15" r="1.8" />
      <circle cx="9.5" cy="18.5" r="1.2" />
      <path d="M3 21.5h18" />
    </>
  ),
  'wash-face': (
    <>
      <circle cx="12" cy="14.5" r="6.5" />
      <path d={`${dot(9.6, 13.4)}${dot(14.4, 13.4)}`} />
      <path d="M9.8 16.4a2.8 2.8 0 0 0 4.4 0" />
      <path d="M12 2.2c-1.1 1.5-1.7 2.5-1.7 3.2a1.7 1.7 0 0 0 3.4 0c0-.7-.6-1.7-1.7-3.2z" />
      <path d="M17.5 4.5c-.6.8-.9 1.3-.9 1.7a.9.9 0 0 0 1.8 0c0-.4-.3-.9-.9-1.7z" />
    </>
  ),
  'brush-teeth': (
    <>
      <path d="M2.5 17h10" />
      <rect x="12.5" y="14" width="9" height="5" rx="1.5" />
      <path d="M14.5 14v-3M17 14v-3M19.5 14v-3" />
      <path d="M13.8 8c1.8-2 5.6-2 7.4 0" />
    </>
  ),
  'brush-hair': (
    <>
      <rect x="3" y="7" width="18" height="5" rx="1.5" />
      <path d="M5.5 12v6M9 12v7M12.5 12v7M16 12v7M19 12v6" />
    </>
  ),
  bath: (
    <>
      <path d="M2.5 12h19v2a5 5 0 0 1-5 5h-9a5 5 0 0 1-5-5z" />
      <path d="M7 19l-1 2.5M17 19l1 2.5" />
      <path d="M5 12V5.5a2.5 2.5 0 0 1 5 0" />
      <circle cx="14" cy="8.5" r="1.8" />
      <circle cx="18" cy="6" r="1.2" />
    </>
  ),
  shower: (
    <>
      <path d="M4 21.5V6a3 3 0 0 1 3-3h4a3 3 0 0 1 3 3v1" />
      <path d="M9.5 10a4.5 3 0 0 1 9 0z" />
      <path d="M11 13.5l-.6 2M14 13.5v2M17 13.5l.6 2M12 18l-.6 2.5M16 18l.6 2.5" />
    </>
  ),
  'get-dressed': (
    <path d="M8.5 3 3 6l2.2 4.5L8 9.4V21h8V9.4l2.8 1.1L21 6l-5.5-3a3.5 3.5 0 0 1-7 0z" />
  ),
  pyjamas: (
    <>
      <path d="M8.5 3 3 6l2.2 4.5L8 9.4V21h8V9.4l2.8 1.1L21 6l-5.5-3a3.5 3.5 0 0 1-7 0z" />
      <path d="M13.2 11.5a3 3 0 1 0 1.8 5 2.4 2.4 0 0 1-1.8-5z" />
    </>
  ),
  socks: (
    <>
      <path d="M8 2.5h6.5v10l4.3 3.4a2.8 2.8 0 0 1-3.3 4.5l-6.4-4.3A2.5 2.5 0 0 1 8 14z" />
      <path d="M8 6h6.5" />
    </>
  ),
  shoes: (
    <>
      <path d="M2 8.5 7.5 7.5l3 5 6.8 2.1a4.5 4.5 0 0 1 3.7 4.4H2z" />
      <path d="M8.3 11.8 10 10.8M10.4 14.5l1.7-1" />
    </>
  ),
  coat: (
    <>
      <path d="M8.5 3 3.5 6.5V16H6v5h12v-5h2.5V6.5L15.5 3" />
      <path d="M8.5 3 12 7l3.5-4" />
      <path d="M12 7v14M6 10.5v5.5M18 10.5v5.5" />
      <path d="M8.5 14.5h1.5M14 14.5h1.5" />
    </>
  ),
  hat: (
    <>
      <path d="M5 15.5V13a7 7 0 0 1 14 0v2.5" />
      <rect x="4" y="15.5" width="16" height="5" rx="1.5" />
      <path d="M8.5 15.5v5M12 15.5v5M15.5 15.5v5" />
      <circle cx="12" cy="4" r="1.8" />
    </>
  ),
  medicine: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="4" />
      <path d="M12 8v8" />
    </>
  ),
  'drink-water': (
    <>
      <path d="M6 3h12l-1.6 17.1a1 1 0 0 1-1 .9H8.6a1 1 0 0 1-1-.9z" />
      <path d="M6.8 10h10.4" />
    </>
  ),
  breakfast: (
    <>
      <path d="M2.5 11h19a9.5 8.5 0 0 1-19 0z" />
      <path d="M15 11l4.5-7.5" />
      <path d={`${dot(7, 8)}${dot(10, 7)}${dot(12.5, 8.5)}`} />
    </>
  ),
  lunchbox: (
    <>
      <rect x="3" y="8" width="18" height="12.5" rx="2" />
      <path d="M9 8V5.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V8" />
      <path d="M3 13h18" />
      <path d="M10.5 13v2.5h3V13" />
    </>
  ),
  'set-table': (
    <>
      <circle cx="12" cy="12.5" r="4.8" />
      <path d="M3 3.5V8a1.5 1.5 0 0 0 3 0V3.5M4.5 9.5v11" />
      <path d="M20.5 3.5c-1.6 1.6-2.2 4-2.2 7.3h2.2v9.7" />
    </>
  ),
  dishes: (
    <>
      <ellipse cx="12" cy="10.5" rx="9" ry="3" />
      <path d="M3 13.8c0 1.7 4 3 9 3s9-1.3 9-3" />
      <path d="M3 17c0 1.7 4 3 9 3s9-1.3 9-3" />
      <circle cx="8" cy="4" r="1.5" />
      <circle cx="12.5" cy="3" r="1" />
      <circle cx="16.5" cy="4.5" r="1.3" />
    </>
  ),
  'help-cook': (
    <>
      <path d="M4 10.5h16V17a3.5 3.5 0 0 1-3.5 3.5h-9A3.5 3.5 0 0 1 4 17z" />
      <path d="M1.8 12.5H4M20 12.5h2.2" />
      <path d="M10 8h4" />
      <path d="M9 5.5c0-1 1-1.2 1-2.3M14 5.5c0-1 1-1.2 1-2.3" />
    </>
  ),
  backpack: (
    <>
      <path d="M5 10a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v10.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M9 5V3.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V5" />
      <path d="M8 21.5V16a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v5.5" />
      <path d="M10.5 18h3" />
    </>
  ),
  homework: (
    <>
      <rect x="3" y="3" width="12" height="18" rx="1.5" />
      <path d="M6 8h6M6 12h6M6 16h3" />
      <path d="M19 7l2.5 2.5-7.3 7.3-3.5 1 1-3.5z" />
    </>
  ),
  reading: (
    <>
      <path d="M12 6.5C10 5 7 4.5 2.5 4.5v14c4.5 0 7.5.5 9.5 2 2-1.5 5-2 9.5-2v-14C17 4.5 14 5 12 6.5z" />
      <path d="M12 6.5v14" />
    </>
  ),
  'school-bus': (
    <>
      <rect x="3" y="3" width="18" height="14.5" rx="2" />
      <path d="M3 10.5h18M12 3v7.5" />
      <path d="M6.5 14h1M16.5 14h1" />
      <circle cx="7.5" cy="19.5" r="2" />
      <circle cx="16.5" cy="19.5" r="2" />
    </>
  ),
  'music-practice': (
    <>
      <path d="M9 18V5.5l11-2.3v12.3" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="15.5" r="3" />
    </>
  ),
  'make-bed': (
    <>
      <path d="M3 4.5v16M21 12v8.5M3 12h18M3 17h18" />
      <rect x="5" y="8.3" width="5.5" height="3.7" rx="1" />
    </>
  ),
  'tidy-toys': (
    <>
      <rect x="2.5" y="12.5" width="8.5" height="8.5" rx="1.2" />
      <rect x="13" y="12.5" width="8.5" height="8.5" rx="1.2" />
      <path d="M12 3l5 8H7z" />
    </>
  ),
  laundry: (
    <>
      <path d="M3.5 10h17l-2.2 11H5.7z" />
      <path d="M8.5 13.5v4.5M12 13.5v4.5M15.5 13.5v4.5" />
      <path d="M7 10a3.5 3 0 0 1 5-2.7A3.5 3 0 0 1 17 10" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M9 6V3.5h6V6" />
      <path d="M5.2 6l1.1 15h11.4l1.1-15" />
      <path d="M10 10v7M14 10v7" />
    </>
  ),
  sweep: (
    <>
      <path d="M21 3l-8.5 8.5" />
      <path d="M10 9.5l4.5 4.5-4 7.5L2.5 13.5z" />
      <path d="M6.5 15.5l2 2" />
    </>
  ),
  'wipe-table': (
    <>
      <rect x="8.5" y="2.5" width="6" height="4.5" rx="1" />
      <path d="M14.5 4.5h2.5" />
      <path d="M10 7v2.2M13 7v2.2" />
      <path d="M8 11.2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v9.3a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z" />
      <path d={`${dot(19.5, 2.5)}${dot(21.5, 4.5)}${dot(19.5, 6.5)}`} />
    </>
  ),
  'water-plants': (
    <>
      <path d="M4 10h10v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M14 13.5l5.5-5" />
      <path d="M18.3 6.7l2.6 2.6" />
      <path d="M6 10a3 3 0 0 1 6 0" />
      <path d="M20 12.5v1.3M21.8 15v1.3M18.3 15.5v1.3" />
    </>
  ),
  groceries: (
    <>
      <path d="M4.5 8h15l-1.2 13H5.7z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  'feed-pet': (
    <>
      <path d="M2.5 15h19l-2 5.5H4.5z" />
      <path d="M6 15a6 3.2 0 0 1 12 0" />
      <path d={`${dot(9, 9.5)}${dot(12, 8.5)}${dot(15, 9.5)}`} />
    </>
  ),
  'walk-dog': (
    <>
      <path d="M12 12.5c-3 0-5 3.2-5 5.3a2.2 2.2 0 0 0 2.2 2.2c1 0 1.8-.5 2.8-.5s1.8.5 2.8.5a2.2 2.2 0 0 0 2.2-2.2c0-2.1-2-5.3-5-5.3z" />
      <circle cx="5" cy="10.5" r="1.8" />
      <circle cx="9" cy="6" r="1.8" />
      <circle cx="15" cy="6" r="1.8" />
      <circle cx="19" cy="10.5" r="1.8" />
    </>
  ),
  exercise: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3v18" />
      <path d="M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8" />
    </>
  ),
  'play-outside': (
    <>
      <path d="M12 2.5a5 5 0 0 0-5 5 4 4 0 0 0 .5 7.5h9a4 4 0 0 0 .5-7.5 5 5 0 0 0-5-5z" />
      <path d="M12 15v6.5M12 18l-2.5-2" />
      <path d="M6.5 21.5h11" />
    </>
  ),
  hug: <path d="M12 20.5s-8.5-4.8-8.5-10.6A4.6 4.6 0 0 1 12 7.2a4.6 4.6 0 0 1 8.5 2.7c0 5.8-8.5 10.6-8.5 10.6z" />,
  bedtime: (
    <>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
      <path d="M17.5 3v3M16 4.5h3" />
    </>
  ),
}

/** Picture for a routine step with no icon: an empty, round step marker. */
const FALLBACK = (
  <>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3" />
  </>
)

export interface RoutineIconProps extends Omit<React.SVGProps<SVGSVGElement>, 'children'> {
  /** Stored `Chore.icon` key. Unknown or empty keys draw the neutral fallback. */
  icon: string | null | undefined
  /**
   * Accessible name. Leave undefined when the surrounding control is already
   * labelled (the usual case): the picture is then hidden from assistive tech.
   */
  title?: string
}

/** One chore picture. Size it with `className` (e.g. `w-24 h-24`); colour follows `currentColor`. */
export function RoutineIcon({ icon, title, className, ...rest }: RoutineIconProps) {
  const drawing = isRoutineIconKey(icon) ? DRAWINGS[icon] : FALLBACK
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
      data-icon={isRoutineIconKey(icon) ? icon : 'none'}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true, focusable: false })}
      {...rest}
    >
      {drawing}
    </svg>
  )
}

/** Keys with a drawing (the tests check this matches the catalogue exactly). */
export const DRAWN_ICON_KEYS = Object.keys(DRAWINGS)

export { routineIconLabel }
