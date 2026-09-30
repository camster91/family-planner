'use client'

/**
 * Gallery sections (#156). Every specimen renders the PRODUCTION component
 * with props from `./fixtures` (deterministic fake data). Actions are local
 * no-ops or local state: nothing here reads the database, calls an API or
 * writes to storage. Components that can only load their own data are left
 * out and listed in docs/design/DESIGN_GALLERY.md.
 */
import * as React from 'react'
import Link from 'next/link'
import { CalendarDays, CheckSquare, ListChecks, Settings, ShoppingCart, UtensilsCrossed, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
// Foundations and primitives
import { Avatar } from '@/components/ui/avatar'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Glyph } from '@/components/ui/glyph'
import { LargeHeader } from '@/components/ui/large-header'
import { InsetList, ListRow, SectionHeader } from '@/components/ui/list-row'
import { LongPressRow } from '@/components/ui/long-press-row'
import { ProgressRing } from '@/components/ui/progress-ring'
import { SearchField } from '@/components/ui/search-field'
import { Skeleton, SkeletonCard, SkeletonRow } from '@/components/ui/Skeleton'
import { SwipeRow } from '@/components/ui/swipe-row'
import RouteLoading from '@/components/ui/route-loading'
import { ToastProvider, useToast, useUndoToast } from '@/components/ui/toast'
// Domain components
import { AmbientCover } from '@/components/fridge/ambient'
import { ChoresRegion, ComingUpRegion, DinnerRegion, GroceriesRegion, ScheduleRegion } from '@/components/fridge/regions'
import { actionLinkClass } from '@/components/fridge/styles'
import { SyncNotice, UpdatedLine } from '@/components/fridge/sync-status'
import { UseSoonRegion } from '@/components/fridge/use-soon-region'
import { WeatherTile } from '@/components/fridge/weather-tile'
import { RoutineIcon, DRAWN_ICON_KEYS, routineIconLabel } from '@/components/chores/RoutineIcon'
import { RoutineFields, RoutineIconPicker } from '@/components/chores/RoutineIconPicker'
import KidRoutines from '@/components/dashboard/KidRoutines'
import { RecipeDetail } from '@/components/meals/RecipeDetail'
import DashboardError from '@/app/dashboard/error'
import { MoveToSectionDialog, type MoveTarget } from '@/app/dashboard/lists/[listId]/MoveToSectionDialog'
import { SyncBanner, syncStatusText } from '@/app/dashboard/lists/[listId]/ListDetailClient'
import { groceryDetailText } from '@/lib/grocery-display'
import { GROCERY_SECTIONS, grocerySectionLabel, type GrocerySectionId } from '@/lib/grocery-sections'
import { MEMBER_COLOR_CSS, MEMBER_COLOR_KEYS, MEMBER_COLOR_LABELS } from '@/lib/member-colors'
import { ContainedFrame, Specimen, SpecimenGrid } from './frame'
import type { GalleryFixtures } from './fixtures'
import { galleryHref, type GalleryOptions } from './options'

export interface SectionProps {
  fx: GalleryFixtures
  options: GalleryOptions
}

const noop = () => undefined

/** Wall-clock instants built in the viewer's zone, so relative times never drift. */
const NOW = new Date(2026, 0, 5, 21, 30).getTime()
const MINUTE = 60 * 1000

// ---------------------------------------------------------------------------
// Foundations

const TOKEN_GROUPS: Array<{ name: string; tokens: string[] }> = [
  {
    name: 'Surfaces',
    tokens: ['--surface-base', '--surface-elevated', '--surface-grouped', '--surface-fill', '--surface-separator'],
  },
  { name: 'Labels', tokens: ['--label-primary', '--label-secondary', '--label-tertiary'] },
  { name: 'Accent', tokens: ['--accent-text', '--accent-fill', '--accent-tint'] },
  {
    name: 'Semantic',
    tokens: ['--success', '--warning', '--warning-text', '--danger', '--danger-text', '--danger-fill'],
  },
  {
    name: 'Module tints',
    tokens: [
      '--tint-chore',
      '--tint-calendar',
      '--tint-lists',
      '--tint-budget',
      '--tint-messages',
      '--tint-family',
      '--tint-rewards',
      '--tint-projects',
      '--tint-meals',
    ],
  },
]

const TYPE_SCALE = [
  'text-large-title',
  'text-title-1',
  'text-title-2',
  'text-title-3',
  'text-headline',
  'text-body',
  'text-callout',
  'text-subhead',
  'text-footnote',
  'text-caption-1',
  'text-caption-2',
]

export function FoundationsSection({ fx }: SectionProps) {
  return (
    <>
      <Specimen name="Colour tokens" source="src/app/globals.css (:root and .dark)">
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {TOKEN_GROUPS.map((group) => (
            <div key={group.name}>
              <p className="text-subhead mb-2 font-semibold text-label-primary">{group.name}</p>
              <ul className="space-y-2">
                {group.tokens.map((token) => (
                  <li key={token} className="flex items-center gap-3" data-token={token}>
                    <span
                      aria-hidden="true"
                      className="h-8 w-8 shrink-0 rounded-[var(--radius-sm)] border border-[var(--surface-separator)]"
                      style={{ background: `var(${token})` }}
                    />
                    <code className="text-footnote break-all text-label-primary">{token}</code>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Specimen>

      <Specimen name="Type scale" source="src/app/globals.css (@layer components)">
        <ul className="space-y-3">
          {TYPE_SCALE.map((cls) => (
            <li key={cls} className="min-w-0">
              <p className={cn(cls, 'break-words text-label-primary')}>{fx.listName}</p>
              <code className="text-caption-1 text-label-secondary">.{cls}</code>
            </li>
          ))}
        </ul>
      </Specimen>

      <SpecimenGrid>
        <Specimen name="Radii" source="--radius-sm … --radius-2xl">
          <div className="flex flex-wrap gap-4">
            {['sm', 'md', 'lg', 'xl', '2xl'].map((r) => (
              <div key={r} className="text-center">
                <div
                  aria-hidden="true"
                  className="h-16 w-16 border border-[var(--surface-separator)] bg-[var(--surface-elevated)]"
                  style={{ borderRadius: `var(--radius-${r})` }}
                />
                <code className="text-caption-1 text-label-secondary">{r}</code>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen name="Shadows" source="--shadow-xs … --shadow-xl">
          <div className="flex flex-wrap gap-5">
            {['xs', 'sm', 'md', 'lg', 'xl'].map((s) => (
              <div key={s} className="text-center">
                <div
                  aria-hidden="true"
                  className="h-16 w-16 rounded-[var(--radius-md)] bg-[var(--surface-elevated)]"
                  style={{ boxShadow: `var(--shadow-${s})` }}
                />
                <code className="text-caption-1 text-label-secondary">{s}</code>
              </div>
            ))}
          </div>
        </Specimen>
      </SpecimenGrid>

      <Specimen
        name="Member colours"
        source="src/lib/member-colors.ts"
        note="Always shown beside a visible name, never as the only signal."
      >
        <ul className="flex flex-wrap gap-3">
          {MEMBER_COLOR_KEYS.map((key) => (
            <li
              key={key}
              className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--surface-fill)] px-3 py-1 text-subhead text-label-primary"
            >
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: MEMBER_COLOR_CSS[key] }}
              />
              {MEMBER_COLOR_LABELS[key]}
            </li>
          ))}
        </ul>
      </Specimen>
    </>
  )
}

// ---------------------------------------------------------------------------
// Buttons and forms

export function ControlsSection({ fx }: SectionProps) {
  const [search, setSearch] = React.useState('milk')
  const [name, setName] = React.useState(fx.listName)
  const [routine, setRoutine] = React.useState('Morning')
  const [order, setOrder] = React.useState('2')
  const [icon, setIcon] = React.useState<string | null>('brush-teeth')
  const [checks, setChecks] = React.useState<Record<string, boolean>>({ a: false, b: true })

  return (
    <>
      <Specimen name="Buttons" source="src/app/globals.css (.btn-*)" note="Enabled, then disabled.">
        <div className="space-y-3">
          {(['btn-filled', 'btn-tinted', 'btn-plain', 'btn-ghost', 'btn-destructive'] as const).map((cls) => (
            <div key={cls} className="flex flex-wrap items-center gap-3">
              <button type="button" className={cn(cls, 'min-h-[44px]')}>
                {cls.replace('btn-', '').replace(/^./, (c) => c.toUpperCase())}
              </button>
              <button type="button" className={cn(cls, 'min-h-[44px]')} disabled>
                Disabled
              </button>
            </div>
          ))}
          <Link href="#controls" className={actionLinkClass}>
            Board action link
          </Link>
        </div>
      </Specimen>

      <SpecimenGrid>
        <Specimen name="Text fields" source="src/app/globals.css (.input-apple, .label-apple)">
          <div className="space-y-4">
            <div>
              <label htmlFor="gallery-list-name" className="label-apple">
                List name
              </label>
              <input
                id="gallery-list-name"
                className="input-apple"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="gallery-list-name-error" className="label-apple">
                List name (with an error)
              </label>
              <input
                id="gallery-list-name-error"
                className="input-apple"
                defaultValue=""
                aria-invalid="true"
                aria-describedby="gallery-list-name-error-text"
              />
              <p id="gallery-list-name-error-text" className="text-footnote mt-1 text-[var(--danger-text)]">
                Give the list a name.
              </p>
            </div>
            <div>
              <label htmlFor="gallery-select" className="label-apple">
                Store section
              </label>
              <select id="gallery-select" className="input-apple" defaultValue="produce">
                {GROCERY_SECTIONS.map((s) => (
                  <option key={s} value={s}>
                    {grocerySectionLabel(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Specimen>

        <Specimen
          name="SearchField"
          source="src/components/ui/search-field.tsx"
          note="Named by its placeholder only; the clear button appears once there is text."
        >
          <SearchField value={search} onChange={setSearch} placeholder="Search the household" />
        </Specimen>
      </SpecimenGrid>

      <SpecimenGrid>
        <Specimen name="RoutineFields" source="src/components/chores/RoutineIconPicker.tsx">
          <RoutineFields
            routine={routine}
            onRoutineChange={setRoutine}
            order={order}
            onOrderChange={setOrder}
            idPrefix="gallery-routine"
          />
        </Specimen>
        <Specimen name="RoutineIconPicker" source="src/components/chores/RoutineIconPicker.tsx">
          <RoutineIconPicker value={icon} onChange={setIcon} idPrefix="gallery-icon" />
        </Specimen>
      </SpecimenGrid>

      <Specimen name="CheckboxRow" source="src/components/ui/checkbox-row.tsx" note="Open, done, disabled and wrapping.">
        <InsetList className="max-w-xl">
          <CheckboxRow
            checked={checks.a}
            onChange={(v) => setChecks((c) => ({ ...c, a: v }))}
            title={fx.itemTitle}
            subtitle="× 2"
            meta="Today"
          />
          <CheckboxRow
            checked={checks.b}
            onChange={(v) => setChecks((c) => ({ ...c, b: v }))}
            title={fx.recipe.title}
            subtitle="Done"
          />
          <CheckboxRow checked disabled onChange={noop} title={fx.listName} subtitle="Checked by a parent" />
          <CheckboxRow
            checked={false}
            onChange={noop}
            wrap
            title={`${fx.recipe.title} · ${fx.listName} · ${fx.itemTitle}`}
            subtitle={fx.recipe.description ?? undefined}
          />
        </InsetList>
      </Specimen>
    </>
  )
}

// ---------------------------------------------------------------------------
// Dialogs, sheets, menus and toasts

/** Adds the frame's toasts once (a ref survives the development double mount). */
function SeedToasts({ fx }: { fx: GalleryFixtures }) {
  const { addToast } = useToast()
  const seeded = React.useRef(false)
  React.useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    const day = 24 * 60 * MINUTE
    addToast({ type: 'undo', title: `Ticked off ${fx.itemTitle}`, duration: day, action: { label: 'Undo', onClick: noop } })
    addToast({ type: 'success', title: 'List saved', message: fx.listName, duration: day })
    addToast({ type: 'error', title: 'Couldn’t save the change', message: 'Check the connection and try again.', duration: day })
  }, [addToast, fx])
  return null
}

function UndoToastTrigger({ fx }: { fx: GalleryFixtures }) {
  const showUndo = useUndoToast()
  return (
    <button
      type="button"
      className="btn-tinted min-h-[44px]"
      data-testid="gallery-show-undo"
      onClick={() => showUndo({ title: `Removed ${fx.itemTitle}`, onUndo: noop })}
    >
      Show an Undo toast
    </button>
  )
}

export function OverlaysSection({ fx }: SectionProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [moveTarget, setMoveTarget] = React.useState<MoveTarget | null>(null)
  const [picked, setPicked] = React.useState<GrocerySectionId | null>(null)

  return (
    <>
      <SpecimenGrid>
        <Specimen
          name="Dialog"
          source="src/components/ui/dialog.tsx"
          note="Focus moves in, Tab stays inside, Escape closes and focus returns to the button."
        >
          <button
            type="button"
            className="btn-filled min-h-[44px]"
            aria-haspopup="dialog"
            data-testid="gallery-open-dialog"
            onClick={() => setDialogOpen(true)}
          >
            Open dialog
          </button>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="Rename list"
            description="Everyone in the household sees the new name."
            testId="gallery-dialog"
          >
            <label htmlFor="gallery-dialog-name" className="label-apple">
              List name
            </label>
            <input id="gallery-dialog-name" className="input-apple" defaultValue={fx.listName} />
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button type="button" className="btn-plain min-h-[44px]" onClick={() => setDialogOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-filled min-h-[44px]" onClick={() => setDialogOpen(false)}>
                Save
              </button>
            </div>
          </Dialog>
        </Specimen>

        <Specimen
          name="MoveToSectionDialog"
          source="src/app/dashboard/lists/[listId]/MoveToSectionDialog.tsx"
          note="A bottom sheet on phones, a centred dialog from sm up."
        >
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            aria-haspopup="dialog"
            data-testid="gallery-open-sheet"
            onClick={() => setMoveTarget({ itemId: 'fx-gallery-row-1', content: fx.itemTitle, current: 'dairy_eggs', chosen: true })}
          >
            Open the Move sheet
          </button>
          {picked && (
            <p className="text-footnote mt-2 text-label-secondary" role="status">
              Picked: {grocerySectionLabel(picked)}
            </p>
          )}
          <MoveToSectionDialog
            target={moveTarget}
            pending={false}
            error={null}
            onPick={(section) => {
              setPicked(section)
              setMoveTarget(null)
            }}
            onClose={() => setMoveTarget(null)}
          />
        </Specimen>
      </SpecimenGrid>

      <SpecimenGrid>
        <Specimen
          name="LongPressRow"
          source="src/components/ui/long-press-row.tsx"
          note="Action sheet on press and hold, right click, the ContextMenu key or Shift+F10; Tab to the row to reveal its More actions button."
        >
          <InsetList className="max-w-xl">
            <LongPressRow
              itemName={fx.listName}
              actions={[
                { label: 'Edit', onClick: noop },
                { label: 'Duplicate', onClick: noop },
                { label: 'Delete', onClick: noop, destructive: true },
              ]}
            >
              <div className="row-apple">
                <span className="text-body text-label-primary">{fx.listName}</span>
              </div>
            </LongPressRow>
          </InsetList>
        </Specimen>

        <Specimen
          name="Toasts"
          source="src/components/ui/toast.tsx"
          note="Undo, success and error toasts in a contained frame; the button shows a live Undo toast from the app's provider."
        >
          <div className="space-y-3">
            <UndoToastTrigger fx={fx} />
            <ContainedFrame label="Toast stack" height={320} testId="gallery-toast-frame">
              <ToastProvider>
                <SeedToasts fx={fx} />
              </ToastProvider>
            </ContainedFrame>
          </div>
        </Specimen>
      </SpecimenGrid>
    </>
  )
}

// ---------------------------------------------------------------------------
// People and status

export function PeopleSection({ fx }: SectionProps) {
  return (
    <>
      <Specimen name="LargeHeader" source="src/components/ui/large-header.tsx">
        <LargeHeader greeting="Good evening" title={fx.members[0].name.split(' ')[0]} subtitle={fx.listName} />
      </Specimen>

      <SpecimenGrid>
        <Specimen name="Avatar" source="src/components/ui/avatar.tsx" note="Sizes xs to xl; initials from the name.">
          <ul className="space-y-3">
            {fx.members.map((m, i) => (
              <li key={m.id} className="flex min-w-0 items-center gap-3">
                <Avatar name={m.name} size={(['xl', 'lg', 'md', 'sm'] as const)[i]} />
                <span className="text-body min-w-0 break-words text-label-primary">{m.name}</span>
              </li>
            ))}
            <li className="flex items-center gap-3">
              <Avatar name="" size="xs" />
              <span className="text-body text-label-secondary">No name</span>
            </li>
          </ul>
        </Specimen>

        <Specimen name="ProgressRing" source="src/components/ui/progress-ring.tsx">
          <div className="flex flex-wrap gap-6">
            {[0, 0.4, 1].map((p) => (
              <ProgressRing key={p} progress={p} size={64} strokeWidth={6}>
                <span className="text-subhead">{Math.round(p * 100)}%</span>
              </ProgressRing>
            ))}
          </div>
        </Specimen>
      </SpecimenGrid>

      <SpecimenGrid>
        <Specimen name="Glyph" source="src/components/ui/glyph.tsx">
          <ul className="flex flex-wrap gap-4">
            {(
              [
                ['chore', CheckSquare],
                ['calendar', CalendarDays],
                ['lists', ShoppingCart],
                ['meals', UtensilsCrossed],
                ['family', Users],
                ['gray', Settings],
              ] as const
            ).map(([color, Icon]) => (
              <li key={color} className="flex flex-col items-center gap-1">
                <Glyph color={color} size="lg">
                  <Icon className="h-7 w-7" aria-hidden="true" />
                </Glyph>
                <span className="text-caption-1 text-label-secondary">{color}</span>
              </li>
            ))}
          </ul>
        </Specimen>

        <Specimen name="ListRow" source="src/components/ui/list-row.tsx">
          <SectionHeader>Household</SectionHeader>
          <InsetList>
            <ListRow icon={Users} glyphColor="family" title={fx.members[1].name} subtitle="Parent" href="#people" />
            <ListRow icon={ListChecks} glyphColor="plain" title={fx.listName} subtitle="5 items" onClick={noop} />
            <ListRow
              icon={Settings}
              glyphColor="gray"
              title="Notifications"
              trailing={<span className="text-subhead text-label-secondary">On</span>}
              showChevron={false}
              last
            />
          </InsetList>
        </Specimen>
      </SpecimenGrid>
    </>
  )
}

// ---------------------------------------------------------------------------
// Schedule

export function ScheduleSection({ fx }: SectionProps) {
  return (
    <>
      <Specimen name="WeatherTile" source="src/components/fridge/weather-tile.tsx" note="Next days appear from 2xl (the 1920px hub).">
        <div className="max-w-3xl">
          <WeatherTile view={fx.weather} />
        </div>
      </Specimen>
      <SpecimenGrid wide>
        <Specimen name="ScheduleRegion" source="src/components/fridge/regions.tsx">
          <ScheduleRegion events={fx.todayEvents} calendarHref="#schedule" people={fx.people} />
        </Specimen>
        <Specimen name="ComingUpRegion" source="src/components/fridge/regions.tsx">
          <ComingUpRegion days={fx.comingUp} mealsEnabled />
        </Specimen>
      </SpecimenGrid>
    </>
  )
}

// ---------------------------------------------------------------------------
// Meals and recipes

export function MealsSection({ fx }: SectionProps) {
  return (
    <SpecimenGrid wide>
      <Specimen name="DinnerRegion" source="src/components/fridge/regions.tsx">
        <DinnerRegion dinner={fx.dinner} mealsEnabled mealsHref="#meals" featuresHref={null} />
      </Specimen>
      <Specimen name="RecipeDetail" source="src/components/meals/RecipeDetail.tsx">
        <div className="card-apple p-5">
          <RecipeDetail recipe={fx.recipe} />
        </div>
      </Specimen>
    </SpecimenGrid>
  )
}

// ---------------------------------------------------------------------------
// Groceries and lists

export function GroceriesSection({ fx }: SectionProps) {
  const [checked, setChecked] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(fx.listRows.map((r) => [r.id, r.checked]))
  )
  const bySection = GROCERY_SECTIONS.map((section) => ({
    section,
    rows: fx.listRows.filter((r) => r.section === section),
  })).filter((g) => g.rows.length > 0)

  return (
    <SpecimenGrid wide>
      <Specimen name="GroceriesRegion" source="src/components/fridge/regions.tsx" note="Rows tick in place on the board.">
        <GroceriesRegion shopping={fx.shopping} listsHref="#groceries" onTick={noop} />
      </Specimen>
      <Specimen
        name="Grocery list rows"
        source="src/app/dashboard/lists/[listId]/ListDetailClient.tsx (SwipeRow + CheckboxRow + groceryDetailText)"
        note="Store sections, amount and recipe provenance; swipe left to delete on touch."
      >
        {bySection.length === 0 ? (
          <EmptyState icon={CheckSquare} glyphColor="lists" title="No items yet" description="Add items using the field below." />
        ) : (
          <div className="space-y-4">
            {bySection.map(({ section, rows }) => (
              <div key={section}>
                <SectionHeader>{grocerySectionLabel(section)}</SectionHeader>
                <InsetList>
                  {rows.map((row) => (
                    <SwipeRow key={row.id} onSwipeLeft={noop}>
                      <CheckboxRow
                        checked={checked[row.id] ?? false}
                        onChange={(v) => setChecked((c) => ({ ...c, [row.id]: v }))}
                        title={row.content}
                        subtitle={groceryDetailText(row) ?? undefined}
                        wrap
                      />
                    </SwipeRow>
                  ))}
                </InsetList>
              </div>
            ))}
          </div>
        )}
      </Specimen>
    </SpecimenGrid>
  )
}

// ---------------------------------------------------------------------------
// Chores and routines

export function ChoresSection({ fx }: SectionProps) {
  const [ticked, setTicked] = React.useState<ReadonlySet<string>>(() => new Set())
  return (
    <>
      <Specimen name="ChoresRegion" source="src/components/fridge/regions.tsx" note="Open, done, waiting for a check, and more than four.">
        <div className="max-w-2xl">
          <ChoresRegion people={fx.personChores} choresHref="#chores" onTick={noop} canTick={() => true} />
        </div>
      </Specimen>
      <Specimen
        name="KidRoutines"
        source="src/components/dashboard/KidRoutines.tsx"
        note="Checked, waiting, next and to-do steps. Tapping a step marks it done here only."
      >
        {fx.routines.length === 0 ? (
          <p className="text-body text-label-secondary">KidRoutines renders nothing without routines for today.</p>
        ) : (
          <KidRoutines
            routines={fx.routines}
            tickedIds={ticked}
            onComplete={(id) => setTicked((prev) => new Set(prev).add(id))}
          />
        )}
      </Specimen>
    </>
  )
}

// ---------------------------------------------------------------------------
// Inventory

export function InventorySection({ fx }: SectionProps) {
  return (
    <Specimen
      name="UseSoonRegion"
      source="src/components/fridge/use-soon-region.tsx"
      note="Expired, use by today, soon; more than five rows adds “N more”."
    >
      <div className="max-w-2xl">
        {fx.useSoon.length === 0 ? (
          <p className="text-body text-label-secondary">UseSoonRegion renders nothing when there is nothing to use soon.</p>
        ) : (
          <UseSoonRegion items={fx.useSoon} inventoryHref="#inventory" />
        )}
      </div>
    </Specimen>
  )
}

// ---------------------------------------------------------------------------
// Empty, loading, error, offline and sync

export function StatesSection({ fx }: SectionProps) {
  const [showError, setShowError] = React.useState(false)
  return (
    <>
      <SpecimenGrid>
        <Specimen name="EmptyState" source="src/components/ui/empty-state.tsx">
          <div className="card-apple">
            <EmptyState
              icon={ShoppingCart}
              glyphColor="lists"
              headingLevel="h4"
              title="The grocery list is clear"
              description="Add something, or add a recipe's ingredients from Meals."
              action={
                <button type="button" className="btn-filled min-h-[44px]">
                  Add an item
                </button>
              }
            />
          </div>
        </Specimen>
        <Specimen name="Skeletons" source="src/components/ui/Skeleton.tsx">
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <SkeletonRow />
            <SkeletonCard />
          </div>
        </Specimen>
      </SpecimenGrid>

      <SpecimenGrid>
        <Specimen name="RouteLoading" source="src/components/ui/route-loading.tsx" note="The loading.tsx of every dashboard tab.">
          <RouteLoading />
        </Specimen>
        <Specimen
          name="DashboardError"
          source="src/app/dashboard/error.tsx"
          note="Moves focus to its heading on mount, so it renders on demand."
        >
          {showError ? (
            <div className="card-apple">
              <DashboardError error={new Error('Design gallery example')} reset={() => setShowError(false)} />
            </div>
          ) : (
            <button type="button" className="btn-tinted min-h-[44px]" data-testid="gallery-show-error" onClick={() => setShowError(true)}>
              Show the route error state
            </button>
          )}
        </Specimen>
      </SpecimenGrid>

      <SpecimenGrid>
        <Specimen name="SyncNotice and UpdatedLine" source="src/components/fridge/sync-status.tsx" note="Board offline, then unreachable (stale).">
          <div className="space-y-3">
            <UpdatedLine lastSyncAt={NOW - 3 * MINUTE} now={NOW} className="text-subhead text-label-secondary" testId="gallery-updated" />
            <SyncNotice lastSyncAt={NOW - 3 * MINUTE} now={NOW} online={false} what="board" />
            <SyncNotice lastSyncAt={NOW - 20 * MINUTE} now={NOW} online canGoStale what="board" />
          </div>
        </Specimen>
        <Specimen
          name="SyncBanner"
          source="src/app/dashboard/lists/[listId]/ListDetailClient.tsx"
          note="Offline with ticks saved on the device; not saved on the device; a queue notice."
        >
          <div className="space-y-3">
            <SyncBanner online={false} durable pendingCount={2} notice={null} onDismiss={noop} />
            <SyncBanner online durable={false} pendingCount={1} notice={null} onDismiss={noop} />
            <SyncBanner online durable notice="queue-full" pendingCount={0} onDismiss={noop} />
          </div>
        </Specimen>
      </SpecimenGrid>

      <Specimen
        name="Offline sync and conflict row text"
        source="src/app/dashboard/lists/[listId]/ListDetailClient.tsx (syncStatusText)"
        note="The words a list row shows for each queued-operation state; never colour alone."
      >
        <InsetList className="max-w-xl">
          <CheckboxRow checked onChange={noop} title={fx.itemTitle} subtitle={syncStatusText(undefined, true)} wrap />
          {fx.syncOps.map(({ label, op }) => (
            <div key={op.id} data-sync-state={op.state} data-testid="gallery-sync-row">
              <CheckboxRow
                checked={op.payload.checked}
                onChange={noop}
                title={`${fx.itemTitle} (${label})`}
                subtitle={syncStatusText(op, false)}
                wrap
              />
            </div>
          ))}
        </InsetList>
      </Specimen>
    </>
  )
}

// ---------------------------------------------------------------------------
// Original graphics

export function GraphicsSection() {
  return (
    <Specimen
      name="RoutineIcon"
      source="src/components/chores/RoutineIcon.tsx"
      note="The original chore picture set for young kids (#272), drawn in-house on a 24px grid. There are no other illustrations in the repository yet (#163)."
    >
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
        {DRAWN_ICON_KEYS.map((key) => (
          <li
            key={key}
            data-icon-key={key}
            className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] bg-[var(--surface-elevated)] p-3 text-center text-label-primary"
          >
            <RoutineIcon icon={key} className="h-12 w-12" />
            <span className="text-caption-1 break-words">{routineIconLabel(key)}</span>
          </li>
        ))}
      </ul>
    </Specimen>
  )
}

// ---------------------------------------------------------------------------
// Fridge calm display and night

export function FridgeSection({ fx, options }: SectionProps) {
  if (options.theme !== 'fridge-night') {
    return (
      <p className="text-body text-label-secondary">
        The calm display and night dimming cover the screen and take focus, so they render only in the{' '}
        <Link className="text-[var(--accent-text)] underline" href={galleryHref({ ...options, theme: 'fridge-night' }, 'fridge')}>
          fridge night theme
        </Link>
        .
      </p>
    )
  }
  const now = new Date(NOW)
  return (
    <SpecimenGrid>
      <Specimen name="AmbientCover (calm display)" source="src/components/fridge/ambient.tsx">
        <ContainedFrame label="Calm display" height={520} testId="gallery-calm-frame">
          <AmbientCover
            state={{ ambient: true, dim: false }}
            now={now}
            weather={fx.weather}
            next={fx.nextEvent}
            dinner={fx.dinner ? fx.dinner.recipeName : null}
            photos={[]}
            onWake={noop}
          />
        </ContainedFrame>
      </Specimen>
      <Specimen name="AmbientCover (night dimming)" source="src/components/fridge/ambient.tsx">
        <ContainedFrame label="Night dimming" height={520} testId="gallery-night-frame">
          <div className="p-6">
            <p className="text-title-2 text-label-primary">{fx.listName}</p>
            <p className="text-body mt-2 text-label-secondary">The board stays visible under the dimming layer.</p>
          </div>
          <AmbientCover
            state={{ ambient: false, dim: true }}
            now={now}
            weather={null}
            next={null}
            dinner={null}
            photos={[]}
            onWake={noop}
          />
        </ContainedFrame>
      </Specimen>
    </SpecimenGrid>
  )
}
