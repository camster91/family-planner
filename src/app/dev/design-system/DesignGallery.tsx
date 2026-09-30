'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { galleryFixtures } from './fixtures'
import { GallerySection } from './frame'
import {
  GALLERY_SECTIONS,
  GALLERY_THEMES,
  GALLERY_THEME_LABELS,
  galleryHref,
  type GalleryOptions,
  type GallerySectionId,
} from './options'
import {
  ChoresSection,
  ControlsSection,
  FoundationsSection,
  FridgeSection,
  GraphicsSection,
  GroceriesSection,
  InventorySection,
  MealsSection,
  OverlaysSection,
  PeopleSection,
  ScheduleSection,
  StatesSection,
  type SectionProps,
} from './sections'

const SECTION_BODIES: Record<GallerySectionId, (props: SectionProps) => React.ReactElement> = {
  foundations: FoundationsSection,
  controls: ControlsSection,
  overlays: OverlaysSection,
  people: PeopleSection,
  schedule: ScheduleSection,
  meals: MealsSection,
  groceries: GroceriesSection,
  chores: ChoresSection,
  inventory: InventorySection,
  states: StatesSection,
  graphics: GraphicsSection,
  fridge: FridgeSection,
}

function OptionLinks<T>({
  label,
  values,
  current,
  href,
  text,
  testId,
}: {
  label: string
  values: readonly T[]
  current: T
  href: (value: T) => string
  text: (value: T) => string
  testId: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-footnote mb-1 font-semibold uppercase tracking-wide text-label-secondary">{label}</p>
      <ul className="flex flex-wrap gap-2" data-testid={testId}>
        {values.map((value) => {
          const active = value === current
          return (
            <li key={String(value)}>
              <Link
                href={href(value)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'inline-flex min-h-[44px] items-center rounded-full px-4 text-subhead font-semibold',
                  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]',
                  active ? 'bg-[var(--accent-fill)] text-white' : 'bg-accent-tint text-accent'
                )}
              >
                {text(value)}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Design gallery (#156): production components with deterministic fake data,
 * for visual QA, accessibility checks and visual snapshots. See
 * docs/design/DESIGN_GALLERY.md. Themes are applied to this subtree (the
 * `.dark` class carries the dark tokens), so the viewer's own saved theme is
 * never read or changed.
 */
export default function DesignGallery({ options }: { options: GalleryOptions }) {
  const fx = React.useMemo(() => galleryFixtures({ long: options.long, empty: options.empty }), [options.long, options.empty])
  const sections = options.section ? GALLERY_SECTIONS.filter((s) => s.id === options.section) : GALLERY_SECTIONS
  const dark = options.theme !== 'light'

  return (
    <div
      data-testid="design-gallery"
      data-theme={options.theme}
      data-long={options.long ? 'true' : 'false'}
      data-data={options.empty ? 'empty' : 'sample'}
      className={cn(dark && 'dark', 'min-h-screen bg-[var(--surface-grouped)] text-label-primary')}
    >
      <a
        href="#gallery-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--surface-elevated)] focus:px-4 focus:py-2"
      >
        Skip to the components
      </a>
      <header className="space-y-5 px-4 pb-6 pt-8 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-footnote font-semibold uppercase tracking-wide text-label-secondary">Development only</p>
          <h1 className="text-large-title break-words text-label-primary">Design gallery</h1>
          <p className="text-body mt-2 text-label-secondary">
            Production components with made-up sample data. Nothing here reads or changes a household.
          </p>
        </div>
        <nav aria-label="Gallery options" className="flex flex-wrap gap-x-8 gap-y-4">
          <OptionLinks
            label="Theme"
            testId="gallery-theme-options"
            values={GALLERY_THEMES}
            current={options.theme}
            href={(theme) => galleryHref({ ...options, theme })}
            text={(theme) => GALLERY_THEME_LABELS[theme]}
          />
          <OptionLinks
            label="Text"
            testId="gallery-text-options"
            values={[false, true]}
            current={options.long}
            href={(long) => galleryHref({ ...options, long })}
            text={(long) => (long ? 'Long (pseudo)' : 'Normal')}
          />
          <OptionLinks
            label="Data"
            testId="gallery-data-options"
            values={[false, true]}
            current={options.empty}
            href={(empty) => galleryHref({ ...options, empty })}
            text={(empty) => (empty ? 'Empty' : 'Sample')}
          />
        </nav>
        <nav aria-label="Gallery sections">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            <li>
              <Link
                href={galleryHref({ ...options, section: null })}
                aria-current={options.section === null ? 'true' : undefined}
                className="text-subhead inline-flex min-h-[44px] items-center text-[var(--accent-text)] underline-offset-2 hover:underline"
              >
                All sections
              </Link>
            </li>
            {GALLERY_SECTIONS.map((s) => (
              <li key={s.id}>
                <Link
                  href={galleryHref({ ...options, section: s.id })}
                  aria-current={options.section === s.id ? 'true' : undefined}
                  className="text-subhead inline-flex min-h-[44px] items-center text-[var(--accent-text)] underline-offset-2 hover:underline"
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="gallery-main" tabIndex={-1} className="outline-none">
        {sections.map((s) => {
          const Body = SECTION_BODIES[s.id]
          return (
            <GallerySection key={s.id} id={s.id} title={s.title}>
              <Body fx={fx} options={options} />
            </GallerySection>
          )
        })}
      </main>
    </div>
  )
}
