'use client'

import * as React from 'react'
import { OwnPreparationNote } from '@/components/calendar/preparation/OwnPreparationNote'
import type { SharedPreparationContext } from '@/lib/event-preparation/shared-discovery' 
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
import { PersonChip } from '@/components/ui/person-chip'
import { cn } from '@/lib/utils'
import { BoardRoutineIcon } from './BoardRoutineIcon'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { formatMinutes } from '@/lib/meal-slots'
import { mealDayHref } from '@/lib/meal-navigation'
import type { ShoppingSnapshot, ShoppingSnapshotItem } from '@/lib/shopping-snapshot'
import type { BoardChore, BoardDinner, BoardEvent } from '@/app/dashboard/today/today-board-data'
import { MEMBER_COLOR_CSS, type MemberColorKey } from '@/lib/member-colors'
import { firstName, formatTime, sharedBoardNames, type ComingUpDay, type PersonChores, type TodayEvent } from './board-model'
import {
  defaultTodayBoardText,
  useTodayBoardText,
  type TodayBoardTranslator,
} from '@/i18n/today-board'
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

/**
 * Splits a fridge card's row budget between people (owner decision
 * 2026-11-19: never hide rows silently). Everyone with open chores gets a row
 * first, then rows go round-robin until the budget or the chores run out.
 * The caller prints "+N more" from what is left, so the count is exact.
 */
export function allotRows(counts: number[], budget: number): number[] {
  const out = counts.map(() => 0)
  let left = Math.max(budget, counts.filter((c) => c > 0).length)
  for (let pass = 0; left > 0; pass++) {
    let gave = false
    for (let i = 0; i < counts.length && left > 0; i++) {
      if (counts[i] > pass) {
        out[i]++
        left--
        gave = true
      }
    }
    if (!gave) break
  }
  return out
}

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
  className,
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
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={`region-${area}`}
      // On a landscape fridge tablet each region scrolls inside itself, so it
      // must be reachable by keyboard to scroll (WCAG 2.1.1). Groceries owns
      // scrolling with its inner list so the continuation stays visible; keep
      // the card programmatically focusable without adding a second tab stop.
      tabIndex={area === 'groceries' ? -1 : 0}
      className={cn(regionClass, areaClass[area], className)}
    >
      <div data-region-heading className="mb-3 flex min-h-[48px] items-center gap-2.5 2xl:mb-4 2xl:min-h-[56px]">
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

/**
 * An empty card on the personal Today page, shrunk to one line: what is
 * missing and the one thing to do first. Person app only; the fridge and the
 * paired tablet keep full-size regions. Keeps the region's test id and
 * labelled section so the layout editor and screen readers still find it.
 */
export function EmptyRegionLine({
  id,
  area,
  title,
  icon: Icon,
  glyph,
  message,
  action,
}: {
  id: string
  area: BoardArea
  title: string
  icon: LucideIcon
  glyph: GlyphColor
  message: string
  /** One inline action (a link or button, at least 44px), or none. */
  action?: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={`region-${area}`}
      data-empty-line=""
      className={cn(regionClass, areaClass[area], 'py-2 md:py-2 lg:py-2 2xl:py-3')}
    >
      {/* One row: the words wrap inside their own block, so the action stays
          beside them instead of dropping to a second row. */}
      <div className="flex min-h-[48px] items-center gap-3">
        <Glyph color={glyph} size="sm">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </Glyph>
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2 id={`${id}-title`} className="text-[17px] font-semibold leading-tight text-label-primary md:text-[18px]">
            {title}
          </h2>
          <p data-testid={`region-empty-${area}`} className={cn(metaTextClass, 'min-w-0 break-words')}>
            {message}
          </p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </section>
  )
}

/**
 * A filled card on the personal Today page, folded into one tappable line
 * (Calm Today): "Dinner tonight · Lemon herb chicken ›". The whole row opens
 * the section and is at least 44px tall. Person app only; the fridge and the
 * paired tablet keep full regions. Keeps the region's test id and labelled
 * section so the layout editor and screen readers still find it.
 */
export function RegionLine({
  id,
  area,
  title,
  icon: Icon,
  glyph,
  href,
  hrefLabel,
  value,
  more,
  valueTestId,
}: {
  id: string
  area: BoardArea
  title: string
  icon: LucideIcon
  glyph: GlyphColor
  /** Where the line goes. Null: the same words, not tappable. */
  href: string | null
  /** Screen-reader words after the line, e.g. "open meals". */
  hrefLabel?: string
  /** The one fact worth a glance: tonight's dinner, "6 to buy", the next event. */
  value: string
  /** A quiet count of the rest, e.g. "+4 more". */
  more?: string | null
  valueTestId?: string
}) {
  const rowClass =
    'flex min-h-[52px] w-full items-center gap-3 rounded-[var(--radius-xl)] px-4 py-2'
  const content = (
    <>
      <Glyph color={glyph} size="sm">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </Glyph>
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <h2 id={`${id}-title`} className="text-[17px] font-semibold leading-tight text-label-primary md:text-[18px]">
          {title}
        </h2>
        <span data-testid={valueTestId ?? `region-line-${area}`} className="min-w-0 break-words text-[16px] leading-snug text-label-primary line-clamp-2 md:text-[17px]">
          {value}
        </span>
        {more && (
          <span data-testid={`region-line-more-${area}`} className="shrink-0 text-[14px] leading-snug text-label-secondary md:text-[15px]">
            {more}
          </span>
        )}
      </span>
    </>
  )
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid={`region-${area}`}
      data-region-line=""
      className={cn(regionClass, areaClass[area], 'p-0 md:p-0 lg:p-0 2xl:p-0')}
    >
      {href ? (
        <Link
          href={href}
          data-testid={`region-link-${area}`}
          className={cn(
            rowClass,
            'active:bg-[var(--surface-fill)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]',
          )}
        >
          {content}
          {hrefLabel && <span className="sr-only">, {hrefLabel}</span>}
          <ChevronRight className="h-5 w-5 shrink-0 text-label-secondary" aria-hidden="true" />
        </Link>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
    </section>
  )
}

/** Compact pill for an EmptyRegionLine action (44px target, pressed state). */
export const emptyLineActionClass = cn(actionLinkClass, 'min-h-[44px] px-4 md:text-[15px]')

/** Imported-calendar label (#232). Text carries the meaning; the dot is decoration. */
function SourceLabel({ source }: { source: NonNullable<BoardEvent['source']> }) {
  const text = useTodayBoardText()
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--surface-fill)] px-3 py-1 text-[15px] text-label-secondary md:text-[16px]">
      <span
        aria-hidden="true"
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: source.color ?? 'var(--label-secondary)' }}
      />
      <span className="min-w-0 break-words">{text('from', { name: source.name })}</span>
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

export function eventTimeLabel(
  e: TodayEvent,
  locale: string,
  text: TodayBoardTranslator = defaultTodayBoardText,
): string {
  if (e.startedEarlier) {
    const end = new Date(e.end)
    const endsToday = end.toDateString() === new Date().toDateString()
    return endsToday ? text('until', { time: formatTime(end, locale) }) : text('allDay')
  }
  return formatTime(e.start, locale)
}

/**
 * "Added by Avery" (#262), demoted to plain small text with no colour: who
 * added an event is not who it is for, so it no longer looks like a person
 * chip. Shown only for an event with no people chosen.
 */
function AddedByLabel({ person }: { person: BoardPerson }) {
  const text = useTodayBoardText()
  return (
    <span data-testid="event-member" className={cn(metaTextClass, 'min-w-0 break-words')}>
      {text('addedBy', { name: firstName(person.name) })}
    </span>
  )
}

/** "For Casey" as a person chip: initial on their colour, first name. */
function ForPersonLabel({ person }: { person: BoardPerson }) {
  const text = useTodayBoardText()
  return (
    <PersonChip
      testId="event-for"
      size="md"
      name={person.name}
      color={person.color}
      label={text('eventFor', { name: firstName(person.name) })}
    />
  )
}

/** Shared event rows keep source, time and member labels identical across app/fridge views. */
export function ScheduleEventRows({
  events,
  people,
  eventAction,
  showAddedBy = true,
}: {
  eventAction?: (event: TodayEvent) => React.ReactNode
  /**
   * "Added by Avery" under an event with no people chosen. The personal Today
   * page leaves it out (Calm Today); the fridge and tablet boards keep it.
   */
  showAddedBy?: boolean
  events: TodayEvent[]
  people?: Map<string, BoardPerson>
}) {
  const locale = useDisplayLocale()
  const text = useTodayBoardText()
  return (
    <ul className="divide-y divide-[var(--surface-separator)]">
      {events.map((e) => {
        const person = showAddedBy && e.addedById ? people?.get(e.addedById) : undefined
        return (
          <li
            key={e.id}
            data-testid="today-event"
            className="flex gap-3 py-3 first:pt-0 2xl:gap-4 2xl:py-4"
          >
            <p className="w-[78px] min-w-[4.875em] shrink-0 pt-0.5 text-[16px] font-semibold tabular-nums text-label-primary md:w-[96px] md:min-w-[5em] md:text-[19px] 2xl:w-[120px] 2xl:text-[24px]">
              {eventTimeLabel(e, locale, text)}
            </p>
            <div className="min-w-0 flex-1">
              <p className={cn(itemTextClass, 'break-words font-medium')}>
                {e.title}
              </p>
              {(e.happeningNow || e.isTask || e.source || person || !!e.forPeople?.length) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  {e.happeningNow && !e.startedEarlier && (
                    <Tag>{text('now')}</Tag>
                  )}
                  {e.isTask && <Tag>{text('task')}</Tag>}
                  {e.forPeople?.length
                    ? e.forPeople.map((who, index) => <ForPersonLabel key={`${index}:${who.name}`} person={who} />)
                    : person && <AddedByLabel person={person} />}
                  {e.source && <SourceLabel source={e.source} />}
                </div>
              )}
              {eventAction?.(e)}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function ScheduleRegion({
  events,
  calendarHref,
  people,
  maxRows = MAX_TODAY_EVENTS,
}: {
  events: TodayEvent[]
  calendarHref: string | null
  /** Member display name and colour by id (#262). */
  people?: Map<string, BoardPerson>
  /** Rows before "N more later today" (the fridge fits fewer in portrait). */
  maxRows?: number
}) {
  const text = useTodayBoardText()
  const shown = events.slice(0, maxRows)
  const more = events.length - shown.length
  return (
    <Region
      id="board-today"
      area="today"
      title={text('today')}
      icon={CalendarDays}
      glyph="calendar"
      href={calendarHref}
      hrefLabel={text('openCalendar')}
    >
      {shown.length === 0 ? (
        <p className={emptyTextClass}>{text('calendarEmpty')}</p>
      ) : (
        <ScheduleEventRows events={shown} people={people} />
      )}
      {more > 0 && <p data-testid="today-more" className={cn(metaTextClass, 'mt-3')}>{text('moreLaterToday', { count: more })}</p>}
    </Region>
  )
}

/**
 * Linked-recipe line for a dinner (ADR-0007, #252): the recipe title when it
 * differs from the meal's own name, and the prep time when known. Null when
 * the meal has no recipe (free-text dinners look exactly as before).
 */
export function dinnerRecipeLine(
  dinner: Pick<BoardDinner, 'recipeName' | 'recipeTitle' | 'prepMinutes'>,
  text: TodayBoardTranslator = defaultTodayBoardText,
): string | null {
  const parts: string[] = []
  const title = dinner.recipeTitle?.trim()
  // Compare with the headline actually shown, so the title never repeats.
  const name = (dinner.recipeName ?? title ?? '').trim()
  if (title && title.toLowerCase() !== name.toLowerCase()) parts.push(text('recipe', { title }))
  const prep = formatMinutes(dinner.prepMinutes)
  if (prep) parts.push(text('prep', { duration: prep }))
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * "2 ingredients not found in inventory" for tonight's linked recipe (#122), or null when
 * nothing is missing or the count is unknown (inventory off, shared device,
 * no recipe, or a recipe without ingredients).
 */
export function missingIngredientsLine(
  count: number | null | undefined,
  text: TodayBoardTranslator = defaultTodayBoardText,
): string | null {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null
  return text(count === 1 ? 'missingIngredientOne' : 'missingIngredientMany', { count })
}

export function DinnerRegion({
  compactLandscape = false,
  day,
  dinner,
  mealsEnabled,
  mealsHref,
  featuresHref,
}: {
  compactLandscape?: boolean
  /** Viewer calendar day, also available when no dinner is planned. */
  day?: string
  dinner: BoardDinner | null
  mealsEnabled: boolean
  mealsHref: string | null
  featuresHref: string | null
}) {
  const text = useTodayBoardText()
  const dinnerHref = mealDayHref(mealsHref, day ?? dinner?.day)
  let body: React.ReactNode
  let action: React.ReactNode = undefined
  // Dinner is already tinted in app mode. Both normal and pressed actions
  // need opaque paper; pressed ink provides feedback without stacking tints.
  const dinnerActionClass = cn(actionLinkClass, 'bg-[var(--surface-elevated)] active:bg-[var(--surface-elevated)] active:text-label-primary')
  if (!mealsEnabled) {
    body = <p className={emptyTextClass}>{text('mealPlanningOff')}</p>
    if (featuresHref) {
      action = (
        <Link href={featuresHref} className={dinnerActionClass}>
          {text('turnOnMealPlanning')}
        </Link>
      )
    }
  } else if (!dinner) {
    body = <p className={emptyTextClass}>{text('dinnerEmpty')}</p>
    if (mealsHref) {
      action = (
        <Link href={dinnerHref!} className={dinnerActionClass}>
          {text('planDinner')}
        </Link>
      )
    }
  } else {
    const recipeLine = dinnerRecipeLine(dinner, text)
    const missingLine = missingIngredientsLine(dinner.missingIngredients, text)
    // #274: the tile heading opens meals; no separate "Open meals" button.
    body = (
      <div data-testid="dinner-tonight">
        <p className={`break-words font-display text-[28px] font-bold leading-tight text-label-primary md:text-[32px] 2xl:text-[40px]${compactLandscape ? ' lg:landscape:text-[24px] 2xl:landscape:text-[40px]' : ''}`} >
          {dinner.recipeName ?? dinner.recipeTitle ?? text('dinnerPlanned')}
        </p>
        {recipeLine && <p className={cn(metaTextClass, 'mt-2 break-words')}>{recipeLine}</p>}
        {missingLine && (
          <p className={cn(metaTextClass, 'mt-2 break-words')} data-testid="dinner-missing">
            {missingLine}
          </p>
        )}
        {dinner.cookName && <p data-testid="dinner-cook" className={cn(metaTextClass, 'mt-2')}>{text('cooking', { name: firstName(dinner.cookName) })}</p>}
        {dinner.hasMoreDinners && <p className={cn(metaTextClass, 'mt-2')} data-testid="dinner-more">{text(mealsHref ? 'moreDinners' : 'moreDinnersShared')}</p>}
      </div>
    )
  }
  return (
    <Region
      id="board-dinner"
      area="dinner"
      title={text('dinnerTonight')}
      icon={UtensilsCrossed}
      glyph="meals"
      href={mealsEnabled ? dinnerHref : null}
      hrefLabel={text('openMeals')}
      action={action}
    >
      {body}
    </Region>
  )
}

export function GroceriesRegion({
  compactLandscape = false,
  shopping,
  listsHref,
  onTick,
  action,
  noList = false,
  maxRows,
}: {
  compactLandscape?: boolean
  /** The household has no grocery list at all: say so instead of "clear". */
  noList?: boolean
  shopping: ShoppingSnapshot | null
  listsHref: string | null
  action?: React.ReactNode
  /** #274: tapping an item ticks it off (with Undo). Null: rows are plain text. */
  onTick?: ((item: ShoppingSnapshotItem) => void) | null
  /**
   * Fridge boards: rows that fit the card. The rest is an honest "+N more"
   * counted against the list's total ("6 to buy" shows 4 and "+2 more").
   */
  maxRows?: number
}) {
  const text = useTodayBoardText()
  if (!shopping) return null
  const groceriesHref = listsHref === '/dashboard/lists' ? '/dashboard/lists/groceries' : listsHref
  const items = maxRows === undefined ? shopping.items : shopping.items.slice(0, maxRows)
  const more = Math.max(0, shopping.total - items.length)
  const moreText = maxRows === undefined ? text('moreToBuy', { count: more }) : text('plusMore', { count: more })
  return (
    <Region
      id="board-groceries"
      area="groceries"
      title={text('groceries')}
      icon={ShoppingCart}
      glyph="lists"
      href={groceriesHref}
      hrefLabel={text('openGroceryLists')}
      className="lg:landscape:min-h-0 lg:landscape:flex lg:landscape:flex-col lg:landscape:overflow-hidden lg:landscape:[&>ul]:min-h-0 lg:landscape:[&>ul]:flex-1 lg:landscape:[&>ul]:overflow-y-auto"
      action={action}
    >
      {shopping.total === 0 ? (
        <p className={emptyTextClass}>{text(noList ? 'groceryNoList' : 'groceryEmpty')}</p>
      ) : (
        <>
          <p className={cn(metaTextClass, 'mb-2')}>{text('toBuy', { count: shopping.total })}</p>
          {items.length > 0 && <ul
            className="divide-y divide-[var(--surface-separator)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
            tabIndex={0}
            aria-label={text('groceries')}
          >
            {items.map((item) => {
              const content = (
                <>
                  <span className={cn(itemTextClass, 'min-w-0 flex-1 break-words md:line-clamp-2')}>{item.content}</span>{' '}
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
                      className={rowButtonClass}
                    >
                      <Circle className="h-6 w-6 shrink-0 text-label-secondary 2xl:h-7 2xl:w-7" aria-hidden="true" />
                      {/* Named by its content so the visible item stays in the spoken name (WCAG 2.5.3). */}
                      <span className="sr-only">{text('tickOff')} </span>
                      {content}
                    </button>
                  ) : (
                    <div className="flex min-h-[52px] items-center gap-3">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>}
        </>
      )}
      {more > 0 &&
        (listsHref ? (
          <div className="mt-3">
            <Link href={groceriesHref!} className={actionLinkClass} data-testid="grocery-more">
              {moreText}
            </Link>
          </div>
        ) : (
          <p data-testid="grocery-more" className={cn(metaTextClass, 'mt-3')}>{moreText}</p>
        ))}
      {listsHref && <div className="mt-3 border-t border-[var(--surface-separator)] pt-2"><Link href="/dashboard/lists" className="inline-flex min-h-[44px] items-center text-subhead text-[var(--accent-text)] 2xl:min-h-[56px]">{text('allSharedLists')} <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" /></Link><p className={`text-footnote text-label-secondary${compactLandscape ? ' lg:landscape:sr-only 2xl:landscape:not-sr-only' : ''}`} >{text('sharedListsDescription')}</p></div>}
    </Region>
  )
}

/** First names only, never a surname ("Maya R." when two share one). */
function displayNames(people: PersonChores[]): Map<string, string> {
  return sharedBoardNames(people.map((p) => p.member))
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
function doneLine(p: PersonChores, text: TodayBoardTranslator = defaultTodayBoardText): string | null {
  if (p.doneCount === 0) return null
  const waiting = p.awaitingCheckCount ?? 0
  return waiting > 0 ? text('doneWaiting', { done: p.doneCount, waiting }) : text('done', { count: p.doneCount })
}

/** One canonical chore action row; the app adds a visible owner when rows are combined. */
export function ChoreRow({
  chore: c,
  name,
  onTick,
  canTick,
  showOwner = false,
  inlineMeta = false,
  preparation,
  action,
}: {
  preparation?: SharedPreparationContext[string]
  action?: React.ReactNode
  chore: BoardChore
  name: string
  onTick?: ((chore: BoardChore) => void) | null
  canTick?: (chore: BoardChore) => boolean
  showOwner?: boolean
  /**
   * Personal Today (Calm Today): the person and status follow the title on
   * the same line ("Tidy bedroom · Casey · In progress") and wrap only when
   * they must. The fridge and tablet boards keep one fact per line.
   */
  inlineMeta?: boolean
}) {
  const text = useTodayBoardText()
  const tickable = Boolean(onTick && (canTick?.(c) ?? true))
  const metaClass = cn(
    metaTextClass,
    inlineMeta
      ? "inline-block before:mx-2 before:content-['·']"
      : 'block',
  )
  const label = (
    <span className="min-w-0 flex-1">
      {/* Picture routines (#272): the chore's picture, when it has one. */}
      {c.icon && (
        <BoardRoutineIcon icon={c.icon} />
      )}
      {c.title}{' '}
      {preparation && <OwnPreparationNote title={preparation.eventTitle} />}
      {showOwner ? (
        <span className={metaClass}>{name}</span>
      ) : (
        tickable && <span className="sr-only">{name}</span>
      )}
      {c.overdue && (
        <span className={metaClass} data-testid="board-chore-overdue">{text('overdue')}</span>
      )}
      {c.status === 'in_progress' && (
        <span className={metaClass}>{text('inProgress')}</span>
      )}
      {c.actionAvailability?.state === 'paused' && (
        <span className={metaClass} role="status">
          {text(c.actionAvailability.reason === 'PROFILE_ARCHIVED' ? 'profileChoreArchived' : 'profileChorePaused')}
        </span>
      )}
    </span>
  )
  return (
    <li data-testid="board-chore" className={cn(itemTextClass, 'break-words')}>
      {onTick && tickable ? (
        <button
          type="button"
          onClick={() => onTick(c)}
          className={cn(rowButtonClass, 'text-left')}
        >
          <Circle
            className="h-6 w-6 shrink-0 text-label-secondary 2xl:h-7 2xl:w-7"
            aria-hidden="true"
          />
          {/* Named by its content so the visible title stays in the spoken name (WCAG 2.5.3). */}
          <span className="sr-only">{text('markDone')} </span>
          {label}
        </button>
      ) : (
        label
      )}
      {action}
    </li>
  )
}

export function ChoresRegion({
  preparationContext = {},
  people,
  choresHref,
  onTick,
  canTick,
  rowBudget,
}: {
  preparationContext?: SharedPreparationContext
  people: PersonChores[]
  choresHref: string | null
  /** #274: tapping a chore marks it done (with Undo). Null: rows are plain text. */
  onTick?: ((chore: BoardChore) => void) | null
  /** Which chores this viewer may tick (own chores, or any for a parent). */
  canTick?: (chore: BoardChore) => boolean
  /**
   * Fridge boards: chore rows the card fits, shared between people
   * (`allotRows`); each person's "+N more" is exact. Omitted: 4 per person.
   */
  rowBudget?: number
}) {
  const text = useTodayBoardText()
  const names = displayNames(people)
  const allotted =
    rowBudget === undefined
      ? people.map((p) => Math.min(p.open.length, MAX_CHORES_PER_PERSON))
      : allotRows(people.map((p) => p.open.length), rowBudget)
  return (
    <Region
      id="board-chores"
      area="chores"
      title={text('choresToday')}
      icon={CheckSquare}
      glyph="chore"
      href={choresHref}
      hrefLabel={text('openChores')}
    >
      {people.length === 0 ? (
        <p className={emptyTextClass}>{text('choresEmpty')}</p>
      ) : (
        <ul className="space-y-4">
          {people.map((p, index) => {
            const name = names.get(p.member.id) ?? firstName(p.member.name)
            const shown = p.open.slice(0, allotted[index])
            const more = p.open.length - shown.length
            const done = doneLine(p, text)
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
                    <p className={cn(metaTextClass, 'mt-1')}>{text('allDoneToday')}</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {shown.map((c) => <ChoreRow key={c.id} chore={c} name={name} onTick={onTick} canTick={canTick} preparation={preparationContext[c.id]} />)}
                      {more > 0 && (
                        <li data-testid="chore-more" className={metaTextClass}>
                          {text(rowBudget === undefined ? 'more' : 'plusMore', { count: more })}
                        </li>
                      )}
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
  maxPerDay = MAX_COMING_UP_EVENTS,
}: {
  days: ComingUpDay[]
  mealsEnabled: boolean
  /** Fridge landscape gives this region a narrow column, so days stack. */
  stackInLandscape?: boolean
  /** Events per day before "N more" (the fridge fits fewer in portrait). */
  maxPerDay?: number
}) {
  const locale = useDisplayLocale()
  const text = useTodayBoardText()
  return (
    <Region id="board-coming" area="coming" title={text('comingUp')} icon={CalendarRange} glyph="family">
      <ul className={cn('grid gap-5 sm:grid-cols-3', stackInLandscape && 'lg:landscape:grid-cols-1')}>
        {days.map((day, dayIndex) => {
          const shown = day.events.slice(0, maxPerDay)
          const more = day.events.length - shown.length
          return (
            <li key={day.dayKey} data-testid="coming-up-day" className="min-w-0">
              <h3 className="text-[20px] font-semibold leading-tight text-label-primary md:text-[22px] 2xl:text-[26px]">
                {dayIndex === 0 && day.label === 'Tomorrow' ? text('tomorrow') : day.label}{' '}<span className="font-normal text-label-secondary">{day.dateLabel}</span>
              </h3>
              {shown.length === 0 ? (
                <p className={cn(metaTextClass, 'mt-2')}>{text('comingEmpty')}</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {shown.map((e) => (
                    <li key={e.id} className="min-w-0">
                      <p className={cn(itemTextClass, 'break-words')}>
                        <span className="font-semibold tabular-nums">{formatTime(e.start, locale)}</span> {e.title}
                      </p>
                      {(!!e.forPeople?.length || e.source) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {e.forPeople?.map((who, index) => (
                            <ForPersonLabel key={`${index}:${who.name}`} person={who} />
                          ))}
                          {e.source && <SourceLabel source={e.source} />}
                        </div>
                      )}
                    </li>
                  ))}
                  {more > 0 && <li className={metaTextClass}>{text('more', { count: more })}</li>}
                </ul>
              )}
              {mealsEnabled && day.dinner && (
                <div className="mt-2 space-y-1">
                  <p className={cn(metaTextClass, 'break-words')}>{text('dinnerLabel', { name: day.dinner.recipeName ?? day.dinner.recipeTitle ?? text('planned') })}</p>
                  {day.dinner.hasMoreDinners && <p className={cn(metaTextClass, 'break-words')}>{text('moreDinnersShared')}</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Region>
  )
}
