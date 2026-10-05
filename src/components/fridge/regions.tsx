'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  CalendarDays,
  CalendarRange,
  CheckSquare,
  ChevronRight,
  Circle,
  Hourglass,
  ShoppingCart,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import { Glyph } from '@/components/ui/glyph'
import { cn } from '@/lib/utils'
import { RoutineIcon } from '@/components/chores/RoutineIcon'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { formatMinutes } from '@/lib/meal-slots'
import type { ShoppingSnapshot, ShoppingSnapshotItem } from '@/lib/shopping-snapshot'
import type { BoardChore, BoardDinner, BoardEvent } from '@/app/dashboard/today/today-board-data'
import { MEMBER_COLOR_CSS, type MemberColorKey } from '@/lib/member-colors'
import { firstName, formatTime, type ComingUpDay, type PersonChores, type TodayEvent } from './board-model'
import {
  actionLinkClass,
  emptyTextClass,
  headerLinkClass,
  itemTextClass,
  metaTextClass,
  regionClass,
  regionTitleClass,
  rowButtonClass,
} from './styles'

/** Rows per region before an "N more" line; keeps each region glanceable. */
const MAX_TODAY_EVENTS = 6
const MAX_CHORES_PER_PERSON = 4
const MAX_COMING_UP_EVENTS = 3

type GlyphColor = React.ComponentProps<typeof Glyph>['color']

/**
 * Board grid areas. `usesoon` is reserved for the inventory "Use soon" tile
 * (#263), which mounts through TodayBoard's `useSoon` slot; see the layout
 * notes there.
 */
export type BoardArea = 'today' | 'dinner' | 'chores' | 'groceries' | 'coming' | 'usesoon'

export const areaClass: Record<BoardArea, string> = {
  today: 'md:[grid-area:today]',
  dinner: 'md:[grid-area:dinner]',
  chores: 'md:[grid-area:chores]',
  groceries: 'md:[grid-area:groceries]',
  coming: 'md:[grid-area:coming]',
  usesoon: 'md:[grid-area:usesoon]',
}

/** A household member as the board labels them: display name plus colour. */
export interface BoardPerson {
  name: string
  color: MemberColorKey
}

export function Region({
  id,
  area,
  title,
  icon: Icon,
  glyph,
  href,
  hrefLabel,
  action,
  children,
}: {
  id: string
  /** CSS grid area name used by the board layout at md+ widths. */
  area: BoardArea
  title: string
  icon: LucideIcon
  glyph: GlyphColor
  /**
   * #274: the tile's own heading opens its section (person sessions; every
   * link is null on a paired tablet), replacing the old "Open …" buttons.
   */
  href?: string | null
  /** Screen-reader words after the title, e.g. "open calendar". */
  hrefLabel?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={`region-${area}`}
      // On a landscape fridge tablet each region scrolls inside itself, so it
      // must be reachable by keyboard to scroll (WCAG 2.1.1).
      tabIndex={0}
      className={cn(regionClass, areaClass[area])}
    >
      <div className="mb-4 flex items-center gap-3">
        <Glyph color={glyph} size="md">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </Glyph>
        <h2 id={`${id}-title`} className={cn(regionTitleClass, 'min-w-0 flex-1')}>
          {href ? (
            <Link href={href} className={headerLinkClass} data-testid={`region-link-${area}`}>
              <span className="min-w-0 break-words">{title}</span>
              {hrefLabel && <span className="sr-only">, {hrefLabel}</span>}
              <ChevronRight className="h-6 w-6 shrink-0 text-label-secondary" aria-hidden="true" />
            </Link>
          ) : (
            title
          )}
        </h2>
      </div>
      {children}
      {action && <div className="mt-4">{action}</div>}
    </section>
  )
}

/** Imported-calendar label (#232). Text carries the meaning; the dot is decoration. */
function SourceLabel({ source }: { source: NonNullable<BoardEvent['source']> }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--surface-fill)] px-3 py-1 text-[15px] text-label-secondary md:text-[16px]">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: source.color ?? 'var(--label-secondary)' }}
      />
      <span className="min-w-0 break-words">From {source.name}</span>
    </span>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-accent-tint px-3 py-1 text-[15px] font-semibold text-accent md:text-[16px]">
      {children}
    </span>
  )
}

function eventTimeLabel(e: TodayEvent, locale: string): string {
  if (e.startedEarlier) {
    const end = new Date(e.end)
    const endsToday = end.toDateString() === new Date().toDateString()
    return endsToday ? `Until ${formatTime(end, locale)}` : 'All day'
  }
  return formatTime(e.start, locale)
}

/** Colour swatch that always sits next to a visible name (never colour-only). */
function MemberSwatch({ color, className }: { color: MemberColorKey; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-member-color={color}
      className={cn('inline-block shrink-0 rounded-full', className)}
      style={{ backgroundColor: MEMBER_COLOR_CSS[color] }}
    />
  )
}

/**
 * "Added by Avery" with the member's colour (#262). Events have no attendee
 * field, so the board says who added it rather than implying who attends.
 */
function AddedByLabel({ person }: { person: BoardPerson }) {
  return (
    <span
      data-testid="event-member"
      className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--surface-fill)] px-3 py-1 text-[15px] font-medium text-label-primary md:text-[16px] 2xl:text-[18px]"
    >
      <MemberSwatch color={person.color} className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
      <span className="min-w-0 break-words">Added by {person.name}</span>
    </span>
  )
}

export function ScheduleRegion({
  events,
  calendarHref,
  people,
}: {
  events: TodayEvent[]
  calendarHref: string | null
  /** Member display name and colour by id (#262). */
  people?: Map<string, BoardPerson>
}) {
  const locale = useDisplayLocale()
  const shown = events.slice(0, MAX_TODAY_EVENTS)
  const more = events.length - shown.length
  return (
    <Region
      id="board-today"
      area="today"
      title="Today"
      icon={CalendarDays}
      glyph="calendar"
      href={calendarHref}
      hrefLabel="open calendar"
    >
      {shown.length === 0 ? (
        <p className={emptyTextClass}>Nothing else on the calendar today.</p>
      ) : (
        <ul className="divide-y divide-[var(--surface-separator)]">
          {shown.map((e) => {
            const person = e.addedById ? people?.get(e.addedById) : undefined
            return (
              <li key={e.id} data-testid="today-event" className="flex gap-4 py-3 first:pt-0 2xl:py-4">
                <p className="w-[96px] shrink-0 whitespace-nowrap pt-0.5 text-[19px] font-semibold tabular-nums text-label-primary md:w-[118px] md:text-[21px] 2xl:w-[132px] 2xl:text-[24px]">
                  {eventTimeLabel(e, locale)}
                </p>
                {/* Member colour rail: decoration beside the name label below. */}
                {person && (
                  <span
                    aria-hidden="true"
                    className="w-1.5 shrink-0 self-stretch rounded-full"
                    style={{ backgroundColor: MEMBER_COLOR_CSS[person.color] }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn(itemTextClass, 'break-words font-medium md:line-clamp-2')}>{e.title}</p>
                  {(e.happeningNow || e.isTask || e.source || person) && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {e.happeningNow && !e.startedEarlier && <Tag>Now</Tag>}
                      {e.isTask && <Tag>Task</Tag>}
                      {person && <AddedByLabel person={person} />}
                      {e.source && <SourceLabel source={e.source} />}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {more > 0 && <p className={cn(metaTextClass, 'mt-3')}>{more} more later today</p>}
    </Region>
  )
}

/**
 * Linked-recipe line for a dinner (ADR-0007, #252): the recipe title when it
 * differs from the meal's own name, and the prep time when known. Null when
 * the meal has no recipe (free-text dinners look exactly as before).
 */
export function dinnerRecipeLine(dinner: Pick<BoardDinner, 'recipeName' | 'recipeTitle' | 'prepMinutes'>): string | null {
  const parts: string[] = []
  const title = dinner.recipeTitle?.trim()
  // Compare with the headline actually shown, so the title never repeats.
  const name = (dinner.recipeName ?? title ?? '').trim()
  if (title && title.toLowerCase() !== name.toLowerCase()) parts.push(`Recipe: ${title}`)
  const prep = formatMinutes(dinner.prepMinutes)
  if (prep) parts.push(`Prep ${prep}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * "2 ingredients missing" for tonight's linked recipe (#122), or null when
 * nothing is missing or the count is unknown (inventory off, shared device,
 * no recipe, or a recipe without ingredients).
 */
export function missingIngredientsLine(count: number | null | undefined): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null
  return `${count} ${count === 1 ? 'ingredient' : 'ingredients'} missing`
}

export function DinnerRegion({
  dinner,
  mealsEnabled,
  mealsHref,
  featuresHref,
}: {
  dinner: BoardDinner | null
  mealsEnabled: boolean
  mealsHref: string | null
  featuresHref: string | null
}) {
  let body: React.ReactNode
  let action: React.ReactNode = undefined
  if (!mealsEnabled) {
    body = <p className={emptyTextClass}>Meal planning is turned off for this household.</p>
    if (featuresHref) {
      action = (
        <Link href={featuresHref} className={actionLinkClass}>
          Turn on meal planning
        </Link>
      )
    }
  } else if (!dinner) {
    body = <p className={emptyTextClass}>No dinner planned yet.</p>
    if (mealsHref) {
      action = (
        <Link href={mealsHref} className={actionLinkClass}>
          Plan dinner
        </Link>
      )
    }
  } else {
    const recipeLine = dinnerRecipeLine(dinner)
    const missingLine = missingIngredientsLine(dinner.missingIngredients)
    // #274: the tile heading opens meals; no separate "Open meals" button.
    body = (
      <div data-testid="dinner-tonight">
        <p className="break-words font-display text-[28px] font-bold leading-tight text-label-primary md:text-[32px] 2xl:text-[40px]">
          {dinner.recipeName ?? dinner.recipeTitle ?? 'Dinner is planned'}
        </p>
        {recipeLine && <p className={cn(metaTextClass, 'mt-2 break-words')}>{recipeLine}</p>}
        {missingLine && (
          <p className={cn(metaTextClass, 'mt-2 break-words')} data-testid="dinner-missing">
            {missingLine}
          </p>
        )}
        {dinner.cookName && <p className={cn(metaTextClass, 'mt-2')}>Cooking: {dinner.cookName}</p>}
      </div>
    )
  }
  return (
    <Region
      id="board-dinner"
      area="dinner"
      title="Dinner tonight"
      icon={UtensilsCrossed}
      glyph="meals"
      href={mealsEnabled ? mealsHref : null}
      hrefLabel="open meals"
      action={action}
    >
      {body}
    </Region>
  )
}

export function GroceriesRegion({
  shopping,
  listsHref,
  onTick,
}: {
  shopping: ShoppingSnapshot | null
  listsHref: string | null
  /** #274: tapping an item ticks it off (with Undo). Null: rows are plain text. */
  onTick?: ((item: ShoppingSnapshotItem) => void) | null
}) {
  if (!shopping) return null
  const more = shopping.total - shopping.items.length
  return (
    <Region
      id="board-groceries"
      area="groceries"
      title="Groceries"
      icon={ShoppingCart}
      glyph="lists"
      href={listsHref}
      hrefLabel="open lists"
    >
      {shopping.items.length === 0 ? (
        <p className={emptyTextClass}>The grocery list is clear.</p>
      ) : (
        <>
          <p className={cn(metaTextClass, 'mb-2')}>{shopping.total} to buy</p>
          <ul className="divide-y divide-[var(--surface-separator)]">
            {shopping.items.map((item) => {
              const content = (
                <>
                  <span className={cn(itemTextClass, 'min-w-0 flex-1 break-words md:line-clamp-2')}>{item.content}</span>
                  {item.quantity > 1 && (
                    <span className={cn(metaTextClass, 'shrink-0 font-semibold tabular-nums')}>
                      × {item.quantity}
                    </span>
                  )}
                </>
              )
              return (
                <li key={item.id} data-testid="grocery-item">
                  {onTick ? (
                    <button
                      type="button"
                      onClick={() => onTick(item)}
                      aria-label={`Tick off ${item.content}${item.quantity > 1 ? `, ${item.quantity}` : ''}`}
                      className={rowButtonClass}
                    >
                      <Circle className="h-6 w-6 shrink-0 text-label-secondary 2xl:h-7 2xl:w-7" aria-hidden="true" />
                      {content}
                    </button>
                  ) : (
                    <div className="flex min-h-[52px] items-center gap-3">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {more > 0 &&
        (listsHref ? (
          <div className="mt-3">
            <Link href={listsHref} className={actionLinkClass}>
              {more} more to buy
            </Link>
          </div>
        ) : (
          <p className={cn(metaTextClass, 'mt-3')}>{more} more to buy</p>
        ))}
    </Region>
  )
}

/** First names, unless two people share one (then full names). */
function displayNames(people: PersonChores[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const p of people) {
    const f = firstName(p.member.name)
    counts.set(f, (counts.get(f) ?? 0) + 1)
  }
  return new Map(
    people.map((p) => {
      const f = firstName(p.member.name)
      return [p.member.id, (counts.get(f) ?? 0) > 1 ? p.member.name : f]
    })
  )
}

/**
 * Initial on the member's colour (#262). White bold 20px+ is large text, and
 * every palette fill is AA for it (src/lib/member-colors.ts). Decoration: the
 * name is always printed next to it.
 */
function Monogram({ name, color }: { name: string; color?: MemberColorKey }) {
  return (
    <span
      aria-hidden="true"
      data-member-color={color}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[20px] font-bold 2xl:h-14 2xl:w-14 2xl:text-[24px]',
        color ? 'text-white' : 'bg-[var(--surface-fill)] text-label-primary'
      )}
      style={color ? { backgroundColor: MEMBER_COLOR_CSS[color] } : undefined}
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

/** "2 done", "2 done · 1 waiting for a parent's check". Text carries the state. */
function doneLine(p: PersonChores): string | null {
  if (p.doneCount === 0) return null
  const waiting = p.awaitingCheckCount ?? 0
  return waiting > 0 ? `${p.doneCount} done · ${waiting} waiting for a parent's check` : `${p.doneCount} done`
}

export function ChoresRegion({
  people,
  choresHref,
  onTick,
  canTick,
}: {
  people: PersonChores[]
  choresHref: string | null
  /** #274: tapping a chore marks it done (with Undo). Null: rows are plain text. */
  onTick?: ((chore: BoardChore) => void) | null
  /** Which chores this viewer may tick (own chores, or any for a parent). */
  canTick?: (chore: BoardChore) => boolean
}) {
  const names = displayNames(people)
  return (
    <Region
      id="board-chores"
      area="chores"
      title="Chores today"
      icon={CheckSquare}
      glyph="chore"
      href={choresHref}
      hrefLabel="open chores"
    >
      {people.length === 0 ? (
        <p className={emptyTextClass}>No chores due today.</p>
      ) : (
        <ul className="space-y-4">
          {people.map((p) => {
            const name = names.get(p.member.id) ?? p.member.name
            const shown = p.open.slice(0, MAX_CHORES_PER_PERSON)
            const more = p.open.length - shown.length
            const done = doneLine(p)
            return (
              <li key={p.member.id} data-testid="chore-person">
                <div className="flex items-center gap-3">
                  <Monogram name={name} color={p.member.color} />
                  <h3 className="min-w-0 flex-1 break-words text-[20px] font-semibold leading-tight text-label-primary md:text-[22px] 2xl:text-[26px]">
                    {name}
                  </h3>
                </div>
                <div className="pl-[56px] 2xl:pl-[68px]">
                  {p.open.length === 0 ? (
                    <p className={cn(metaTextClass, 'mt-1')}>All done for today</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {shown.map((c) => {
                        const label = (
                          <span className="min-w-0 flex-1">
                            {/* Picture routines (#272): the chore's picture, when it has one. */}
                            {c.icon && (
                              <RoutineIcon
                                icon={c.icon}
                                className="mr-2 inline-block h-6 w-6 align-[-4px] text-label-secondary"
                              />
                            )}
                            {c.title}
                            {c.status === 'in_progress' && (
                              <span className={cn(metaTextClass, 'block')}>In progress</span>
                            )}
                          </span>
                        )
                        return (
                          <li key={c.id} data-testid="board-chore" className={cn(itemTextClass, 'break-words')}>
                            {onTick && (canTick?.(c) ?? true) ? (
                              <button
                                type="button"
                                onClick={() => onTick(c)}
                                aria-label={`Mark ${c.title} done, ${name}`}
                                className={cn(rowButtonClass, 'text-left')}
                              >
                                <Circle
                                  className="h-6 w-6 shrink-0 text-label-secondary 2xl:h-7 2xl:w-7"
                                  aria-hidden="true"
                                />
                                {label}
                              </button>
                            ) : (
                              label
                            )}
                          </li>
                        )
                      })}
                      {more > 0 && <li className={metaTextClass}>{more} more</li>}
                    </ul>
                  )}
                  {done && (
                    <p data-testid="chore-done" className={cn(metaTextClass, 'mt-1 flex items-start gap-2')}>
                      {(p.awaitingCheckCount ?? 0) > 0 && (
                        <Hourglass className="mt-1 h-4 w-4 shrink-0 2xl:h-5 2xl:w-5" aria-hidden="true" />
                      )}
                      <span>{done}</span>
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Region>
  )
}

export function ComingUpRegion({
  days,
  mealsEnabled,
  stackInLandscape = false,
}: {
  days: ComingUpDay[]
  mealsEnabled: boolean
  /** Fridge landscape gives this region a narrow column, so days stack. */
  stackInLandscape?: boolean
}) {
  const locale = useDisplayLocale()
  return (
    <Region id="board-coming" area="coming" title="Coming up" icon={CalendarRange} glyph="family">
      <ul className={cn('grid gap-5 sm:grid-cols-3', stackInLandscape && 'lg:landscape:grid-cols-1')}>
        {days.map((day) => {
          const shown = day.events.slice(0, MAX_COMING_UP_EVENTS)
          const more = day.events.length - shown.length
          return (
            <li key={day.dayKey} data-testid="coming-up-day" className="min-w-0">
              <h3 className="text-[20px] font-semibold leading-tight text-label-primary md:text-[22px] 2xl:text-[26px]">
                {day.label} <span className="font-normal text-label-secondary">{day.dateLabel}</span>
              </h3>
              {shown.length === 0 ? (
                <p className={cn(metaTextClass, 'mt-2')}>Nothing on the calendar</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {shown.map((e) => (
                    <li key={e.id} className="min-w-0">
                      <p className={cn(itemTextClass, 'break-words')}>
                        <span className="font-semibold tabular-nums">{formatTime(e.start, locale)}</span> {e.title}
                      </p>
                      {e.source && (
                        <div className="mt-1">
                          <SourceLabel source={e.source} />
                        </div>
                      )}
                    </li>
                  ))}
                  {more > 0 && <li className={metaTextClass}>{more} more</li>}
                </ul>
              )}
              {mealsEnabled && day.dinner && (
                <p className={cn(metaTextClass, 'mt-2 break-words')}>Dinner: {day.dinner.recipeName ?? day.dinner.recipeTitle ?? 'planned'}</p>
              )}
            </li>
          )
        })}
      </ul>
    </Region>
  )
}
