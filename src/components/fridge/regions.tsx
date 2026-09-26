'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  CalendarDays,
  CalendarRange,
  CheckSquare,
  ChevronRight,
  ShoppingCart,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import { Glyph } from '@/components/ui/glyph'
import { cn } from '@/lib/utils'
import type { ShoppingSnapshot } from '@/lib/shopping-snapshot'
import type { BoardDinner, BoardEvent } from '@/app/dashboard/today/today-board-data'
import { firstName, formatTime, type ComingUpDay, type PersonChores, type TodayEvent } from './board-model'
import {
  actionLinkClass,
  emptyTextClass,
  itemTextClass,
  metaTextClass,
  regionClass,
  regionTitleClass,
  rowLinkClass,
} from './styles'

/** Rows per region before an "N more" line; keeps each region glanceable. */
const MAX_TODAY_EVENTS = 6
const MAX_CHORES_PER_PERSON = 4
const MAX_COMING_UP_EVENTS = 3

type GlyphColor = React.ComponentProps<typeof Glyph>['color']

function Region({
  id,
  area,
  title,
  icon: Icon,
  glyph,
  action,
  children,
}: {
  id: string
  /** CSS grid area name used by the board layout at md+ widths. */
  area: 'today' | 'dinner' | 'chores' | 'groceries' | 'coming'
  title: string
  icon: LucideIcon
  glyph: GlyphColor
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const areaClass = {
    today: 'md:[grid-area:today]',
    dinner: 'md:[grid-area:dinner]',
    chores: 'md:[grid-area:chores]',
    groceries: 'md:[grid-area:groceries]',
    coming: 'md:[grid-area:coming]',
  }[area]
  return (
    <section aria-labelledby={`${id}-title`} data-testid={`region-${area}`} className={cn(regionClass, areaClass)}>
      <div className="mb-4 flex items-center gap-3">
        <Glyph color={glyph} size="md">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </Glyph>
        <h2 id={`${id}-title`} className={cn(regionTitleClass, 'min-w-0 flex-1')}>
          {title}
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

function eventTimeLabel(e: TodayEvent): string {
  if (e.startedEarlier) {
    const end = new Date(e.end)
    const endsToday = end.toDateString() === new Date().toDateString()
    return endsToday ? `Until ${formatTime(end)}` : 'All day'
  }
  return formatTime(e.start)
}

export function ScheduleRegion({ events, calendarHref }: { events: TodayEvent[]; calendarHref: string | null }) {
  const shown = events.slice(0, MAX_TODAY_EVENTS)
  const more = events.length - shown.length
  return (
    <Region
      id="board-today"
      area="today"
      title="Today"
      icon={CalendarDays}
      glyph="calendar"
      action={
        calendarHref ? (
          <Link href={calendarHref} className={actionLinkClass}>
            Open calendar
          </Link>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <p className={emptyTextClass}>Nothing else on the calendar today.</p>
      ) : (
        <ul className="divide-y divide-[var(--surface-separator)]">
          {shown.map((e) => (
            <li key={e.id} data-testid="today-event" className="flex gap-4 py-3 first:pt-0">
              <p className="w-[96px] shrink-0 whitespace-nowrap pt-0.5 text-[19px] font-semibold tabular-nums text-label-primary md:w-[118px] md:text-[21px]">
                {eventTimeLabel(e)}
              </p>
              <div className="min-w-0 flex-1">
                <p className={cn(itemTextClass, 'break-words font-medium md:line-clamp-2')}>{e.title}</p>
                {(e.happeningNow || e.isTask || e.source) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {e.happeningNow && !e.startedEarlier && <Tag>Now</Tag>}
                    {e.isTask && <Tag>Task</Tag>}
                    {e.source && <SourceLabel source={e.source} />}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className={cn(metaTextClass, 'mt-3')}>{more} more later today</p>}
    </Region>
  )
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
    body = (
      <div data-testid="dinner-tonight">
        <p className="break-words font-display text-[28px] font-bold leading-tight text-label-primary md:text-[32px]">
          {dinner.recipeName ?? 'Dinner is planned'}
        </p>
        {dinner.cookName && <p className={cn(metaTextClass, 'mt-2')}>Cooking: {dinner.cookName}</p>}
      </div>
    )
    if (mealsHref) {
      action = (
        <Link href={mealsHref} className={actionLinkClass}>
          Open meals
        </Link>
      )
    }
  }
  return (
    <Region id="board-dinner" area="dinner" title="Dinner tonight" icon={UtensilsCrossed} glyph="meals" action={action}>
      {body}
    </Region>
  )
}

export function GroceriesRegion({ shopping, listsHref }: { shopping: ShoppingSnapshot | null; listsHref: string | null }) {
  if (!shopping) return null
  const more = shopping.total - shopping.items.length
  return (
    <Region id="board-groceries" area="groceries" title="Groceries" icon={ShoppingCart} glyph="lists">
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
                  {listsHref ? (
                    <Link href={`${listsHref}/${item.listId}`} className={rowLinkClass}>
                      {content}
                      <ChevronRight className="h-5 w-5 shrink-0 text-label-secondary" aria-hidden="true" />
                    </Link>
                  ) : (
                    <div className="flex min-h-[52px] items-center gap-3">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {listsHref && (
        <div className="mt-3">
          {more > 0 ? (
            <Link href={listsHref} className={actionLinkClass}>
              {more} more to buy
            </Link>
          ) : (
            <Link href={listsHref} className={actionLinkClass}>
              Open lists
            </Link>
          )}
        </div>
      )}
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

function Monogram({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--surface-fill)] text-[17px] font-bold text-label-primary"
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

export function ChoresRegion({ people, choresHref }: { people: PersonChores[]; choresHref: string | null }) {
  const names = displayNames(people)
  return (
    <Region
      id="board-chores"
      area="chores"
      title="Chores today"
      icon={CheckSquare}
      glyph="chore"
      action={
        choresHref ? (
          <Link href={choresHref} className={actionLinkClass}>
            Open chores
          </Link>
        ) : undefined
      }
    >
      {people.length === 0 ? (
        <p className={emptyTextClass}>No chores due today.</p>
      ) : (
        <ul className="space-y-4">
          {people.map((p) => {
            const name = names.get(p.member.id) ?? p.member.name
            const shown = p.open.slice(0, MAX_CHORES_PER_PERSON)
            const more = p.open.length - shown.length
            return (
              <li key={p.member.id} data-testid="chore-person">
                <div className="flex items-center gap-3">
                  <Monogram name={name} />
                  <h3 className="min-w-0 flex-1 break-words text-[20px] font-semibold leading-tight text-label-primary md:text-[22px]">
                    {name}
                  </h3>
                </div>
                {p.open.length === 0 ? (
                  <p className={cn(metaTextClass, 'mt-1 pl-[52px]')}>All done for today</p>
                ) : (
                  <ul className="mt-1 space-y-1 pl-[52px]">
                    {shown.map((c) => (
                      <li key={c.id} className={cn(itemTextClass, 'break-words')}>
                        {c.title}
                        {c.status === 'in_progress' && (
                          <span className={cn(metaTextClass, 'block')}>In progress</span>
                        )}
                      </li>
                    ))}
                    {more > 0 && <li className={metaTextClass}>{more} more</li>}
                    {p.doneCount > 0 && <li className={metaTextClass}>{p.doneCount} done</li>}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Region>
  )
}

export function ComingUpRegion({ days, mealsEnabled }: { days: ComingUpDay[]; mealsEnabled: boolean }) {
  return (
    <Region id="board-coming" area="coming" title="Coming up" icon={CalendarRange} glyph="family">
      <ul className="grid gap-5 sm:grid-cols-3">
        {days.map((day) => {
          const shown = day.events.slice(0, MAX_COMING_UP_EVENTS)
          const more = day.events.length - shown.length
          return (
            <li key={day.dayKey} data-testid="coming-up-day" className="min-w-0">
              <h3 className="text-[20px] font-semibold leading-tight text-label-primary md:text-[22px]">
                {day.label} <span className="font-normal text-label-secondary">{day.dateLabel}</span>
              </h3>
              {shown.length === 0 ? (
                <p className={cn(metaTextClass, 'mt-2')}>Nothing on the calendar</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {shown.map((e) => (
                    <li key={e.id} className="min-w-0">
                      <p className={cn(itemTextClass, 'break-words')}>
                        <span className="font-semibold tabular-nums">{formatTime(e.start)}</span> {e.title}
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
                <p className={cn(metaTextClass, 'mt-2 break-words')}>Dinner: {day.dinner.recipeName ?? 'planned'}</p>
              )}
            </li>
          )
        })}
      </ul>
    </Region>
  )
}
