'use client'

import * as React from 'react'
import { Gift, Cake, Heart } from 'lucide-react'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { FeatureGate } from '@/components/ui/feature-gate'
import { cn } from '@/lib/utils'

interface FamilyDate {
  id: string
  name: string
  type: 'birthday' | 'anniversary'
  date: string
  role?: string
}

const DEMO_DATES: FamilyDate[] = [
  { id: '1', name: 'Emma Johnson', type: 'birthday', date: '2026-06-15', role: 'daughter' },
  { id: '2', name: 'Michael & Sarah', type: 'anniversary', date: '2026-06-20' },
  { id: '3', name: 'Jack', type: 'birthday', date: '2026-07-03', role: 'son' },
  { id: '4', name: 'Grandma Rose', type: 'birthday', date: '2026-08-12' },
]

function getDaysUntil(dateStr: string): number {
  const now = new Date()
  const target = new Date(dateStr)
  const diff = target.getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function getDateSubtitle(date: FamilyDate, daysUntil: number): string {
  const dateStr = formatDate(date.date)
  if (daysUntil === 0) return `${dateStr} · Today!`
  if (daysUntil === 1) return `${dateStr} · Tomorrow`
  return `${dateStr} · ${daysUntil} days away`
}

function buildDateItems(dates: FamilyDate[]): {
  birthdays: (FamilyDate & { daysUntil: number })[]
  anniversaries: (FamilyDate & { daysUntil: number })[]
} {
  const withDays = dates.map(d => ({ ...d, daysUntil: getDaysUntil(d.date) }))
  return {
    birthdays: withDays.filter(d => d.type === 'birthday').sort((a, b) => a.daysUntil - b.daysUntil),
    anniversaries: withDays.filter(d => d.type === 'anniversary').sort((a, b) => a.daysUntil - b.daysUntil),
  }
}

type DateItem = FamilyDate & { daysUntil: number }

function DateSection({
  title,
  items,
  icon,
  glyphColor,
}: {
  title: string
  items: DateItem[]
  icon: typeof Cake
  glyphColor: 'family' | 'rewards'
}) {
  if (items.length === 0) return null
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <InsetList>
        {items.map((item, i) => (
          <ListRow
            key={item.id}
            icon={icon}
            glyphColor={glyphColor}
            title={item.name}
            subtitle={getDateSubtitle(item, item.daysUntil)}
            trailing={
              item.role ? (
                <span className="text-caption-1 text-label-tertiary capitalize">
                  {item.role}
                </span>
              ) : null
            }
            showChevron={false}
            last={i === items.length - 1}
          />
        ))}
      </InsetList>
    </div>
  )
}

export default function AnniversariesPage() {
  return (
    <FeatureGate featureKey="anniversaries">
      <AnniversariesPageInner />
    </FeatureGate>
  )
}

function AnniversariesPageInner() {
  const dates = DEMO_DATES
  const { birthdays, anniversaries } = buildDateItems(dates)

  const birthdayItems = birthdays.filter(d => d.daysUntil >= 0 && d.daysUntil <= 90)
  const anniversaryItems = anniversaries.filter(d => d.daysUntil >= 0 && d.daysUntil <= 90)
  const laterBirthdays = birthdays.filter(d => d.daysUntil > 90)
  const laterAnniversaries = anniversaries.filter(d => d.daysUntil > 90)

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-large-title font-display">Dates</h1>
        <p className="text-subhead text-label-secondary mt-0.5">
          Birthdays &amp; anniversaries
        </p>
      </div>

      {birthdayItems.length > 0 && (
        <DateSection title="Birthdays" items={birthdayItems} icon={Cake} glyphColor="family" />
      )}
      {anniversaryItems.length > 0 && (
        <DateSection title="Anniversaries" items={anniversaryItems} icon={Heart} glyphColor="rewards" />
      )}
      {laterBirthdays.length > 0 && (
        <DateSection title="Birthdays later" items={laterBirthdays} icon={Cake} glyphColor="family" />
      )}
      {laterAnniversaries.length > 0 && (
        <DateSection title="Anniversaries later" items={laterAnniversaries} icon={Heart} glyphColor="rewards" />
      )}

      {dates.length === 0 && (
        <div className="card-apple p-8 text-center">
          <Gift className="w-10 h-10 text-label-tertiary mx-auto mb-3" />
          <h3 className="text-title-3 text-label-primary">No dates yet</h3>
          <p className="text-subhead text-label-secondary mt-1">
            Add birthdays and anniversaries in Family settings
          </p>
        </div>
      )}
    </div>
  )
}