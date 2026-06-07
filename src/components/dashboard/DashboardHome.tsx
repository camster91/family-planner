'use client'

import { Calendar, ShoppingCart, Car, Wallet, Cake, ImageIcon } from 'lucide-react'
import Link from 'next/link'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { Avatar } from '@/components/ui/avatar'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { ProgressRing } from '@/components/ui/progress-ring'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'

interface Chore {
  id: string
  title: string
  due_date: string
  status: string
}

interface Event {
  id: string
  title: string
  start_time: string
  location?: string | null
}

interface Stats {
  totalChores: number
  completedChores: number
  pendingChores: number
  upcomingEvents: number
  unreadMessages: number
}

interface LeaderboardMember {
  rank: number
  id: string
  name: string
  xp: number
  level: number
  streak: number
  bestStreak: number
  avatar?: string | null
  role: string
}

interface DashboardHomeProps {
  user: {
    name?: string
    role?: UserRole
    avatar_url?: string | null
    family_id?: string | null
  }
  chores: Chore[]
  events: Event[]
  stats: Stats
  completionRate: number
  leaderboard?: LeaderboardMember[]
  pickups?: any[]
  allowancePending?: any[]
  anniversaries?: any[]
  photoVerifyQueue?: any[]
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function DashboardHome({
  user,
  chores,
  events,
  stats,
  completionRate,
  leaderboard = [],
  pickups = [],
  allowancePending = [],
  anniversaries = [],
  photoVerifyQueue = [],
}: DashboardHomeProps) {
  const today = new Date()
  const greeting = getGreeting()
  const isParent = user.role === 'parent'

  // Today's chores (pending + in_progress)
  const todayChores = chores?.filter(
    (c) => c.status === 'pending' || c.status === 'in_progress'
  ) ?? []

  // Shopping items: use unread messages as stand-in (max 5)
  const shoppingItems = (stats.unreadMessages ?? 0) > 0
    ? Array.from({ length: Math.min(stats.unreadMessages, 5) }).map((_, i) => ({
        id: `shopping-${i}`,
        title: `Shopping item ${i + 1}`,
        checked: false,
      }))
    : []

  // Family members for avatar row (up to 6)
  const familyMembers = leaderboard.slice(0, 6)

  return (
    <div className="pb-20">
      {/* Large Header: "Good morning, {name}" + date subtitle + avatar */}
      <LargeHeader
        greeting={greeting}
        title={user?.name ?? 'there'}
        subtitle={formatDate(today)}
        trailing={
          <Avatar
            name={user?.name ?? '?'}
            src={user?.avatar_url}
            size="lg"
          />
        }
        className="px-4"
      />

      <div className="space-y-6 px-4">
        {/* Progress Ring summary card */}
        <div className="card-apple p-5 flex items-center gap-5">
          <ProgressRing
            progress={stats.totalChores > 0 ? stats.completedChores / stats.totalChores : 0}
            size={80}
            strokeWidth={8}
          >
            <span className="text-[28px] font-bold leading-none">
              {stats.completedChores}
            </span>
          </ProgressRing>
          <div className="flex-1 min-w-0">
            <p className="text-title-3 text-label-primary leading-tight">
              {stats.totalChores > 0
                ? `${stats.completedChores} of ${stats.totalChores} done today`
                : 'No chores today'}
            </p>
            {stats.pendingChores > 0 && (
              <p className="text-subhead text-label-secondary mt-1">
                {stats.pendingChores} pending
              </p>
            )}
          </div>
        </div>

        {/* Today's Chores */}
        {todayChores.length > 0 && (
          <section>
            <p className="section-header">My Chores</p>
            <div className="list-inset">
              {todayChores.map((chore, i) => (
                <CheckboxRow
                  key={chore.id}
                  checked={chore.status === 'completed' || chore.status === 'verified'}
                  onChange={() => {/* toggle chore status - to be wired to API */}}
                  title={chore.title}
                  subtitle={formatRelativeDate(chore.due_date)}
                  glyph={
                    <Glyph color="chore" size="sm">
                      <span className="text-sm">✓</span>
                    </Glyph>
                  }
                  className={cn(i === todayChores.length - 1 && 'border-b-0')}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty state for no chores */}
        {todayChores.length === 0 && (
          <EmptyState
            icon={Calendar}
            glyphColor="chore"
            title="All done for today!"
            description="You have no pending chores. Enjoy your day!"
          />
        )}

        {/* Upcoming Events */}
        <section>
          <p className="section-header">Today</p>
          {events && events.length > 0 ? (
            <div className="list-inset">
              {events.map((event, i) => (
                <ListRow
                  key={event.id}
                  icon={Calendar}
                  glyphColor="calendar"
                  title={event.title}
                  subtitle={
                    event.location
                      ? `${formatTime(event.start_time)} · ${event.location}`
                      : formatTime(event.start_time)
                  }
                  showChevron={false}
                  trailing={
                    <span className="text-footnote text-label-tertiary">
                      {formatRelativeDate(event.start_time)}
                    </span>
                  }
                  className={cn(i === events.length - 1 && 'border-b-0')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Calendar}
              glyphColor="calendar"
              title="No events today"
              description="Your calendar is clear."
            />
          )}
        </section>

        {/* Shopping */}
        {shoppingItems.length > 0 && (
          <section>
            <p className="section-header">Shopping</p>
            <div className="list-inset">
              {shoppingItems.map((item, i) => (
                <CheckboxRow
                  key={item.id}
                  checked={item.checked}
                  onChange={() => {/* toggle shopping item */}}
                  title={item.title}
                  glyph={
                    <Glyph color="lists" size="sm">
                      <ShoppingCart className="w-4 h-4 text-white" />
                    </Glyph>
                  }
                  className={cn(i === shoppingItems.length - 1 && 'border-b-0')}
                />
              ))}
            </div>
          </section>
        )}

        {/* Family */}
        {familyMembers.length > 0 && (
          <section>
            <p className="section-header">Family</p>
            <div className="card-apple p-4">
              {/* Avatar row */}
              <div className="flex items-center justify-around py-2">
                {familyMembers.map((member) => (
                  <div key={member.id} className="flex flex-col items-center gap-1.5">
                    <Avatar name={member.name} src={member.avatar} size="lg" />
                    <span className="text-caption-1 text-label-secondary font-medium">
                      {member.xp} XP
                    </span>
                  </div>
                ))}
              </div>

              {/* Budget snapshot for parents */}
              {isParent && (
                <div className="mt-4 pt-4 border-t border-[var(--surface-separator)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-subhead text-label-secondary">Budget this month</span>
                    <span className="text-subhead text-label-primary font-medium">
                      $1,240 of $2,000
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--surface-fill)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--accent-fill)]"
                      style={{ width: '62%' }}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Photo verification queue (parents only) */}
        {isParent && photoVerifyQueue.length > 0 && (
          <section>
            <SectionHeader>Needs your review</SectionHeader>
            <InsetList>
              {photoVerifyQueue.map((chore: any, i: number) => (
                <Link
                  key={chore.id}
                  href="/dashboard/chores"
                  className={cn('row-apple', i === photoVerifyQueue.length - 1 ? '' : 'border-b border-[var(--surface-separator)]')}
                >
                  {chore.assignee?.avatar_url ? (
                    <Avatar name={chore.assignee.name || '?'} src={chore.assignee.avatar_url} size="sm" />
                  ) : (
                    <div className="glyph bg-tint-calendar">
                      <ImageIcon className="w-5 h-5 text-white" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-body text-label-primary">{chore.title}</div>
                    <div className="text-footnote text-label-secondary truncate">
                      {chore.assignee?.name} · {chore.photo_url ? 'Photo submitted' : 'Marked done'}
                    </div>
                  </div>
                  <span className="text-caption-1 font-semibold text-[var(--warning)] uppercase tracking-wide">
                    Review
                  </span>
                </Link>
              ))}
            </InsetList>
          </section>
        )}

        {/* Upcoming pickups */}
        {pickups.length > 0 && (
          <section>
            <SectionHeader>Pickups</SectionHeader>
            <InsetList>
              {pickups.map((p: any, i: number) => (
                <ListRow
                  key={p.id}
                  icon={Car}
                  glyphColor="calendar"
                  title={p.title}
                  subtitle={p.location || '—'}
                  trailing={
                    <span className="text-footnote text-label-tertiary">
                      {new Date(p.pickup_time).toLocaleString(undefined, {
                        weekday: 'short', hour: 'numeric', minute: '2-digit',
                      })}
                    </span>
                  }
                  showChevron
                  href="/dashboard/pickups"
                  last={i === pickups.length - 1}
                />
              ))}
            </InsetList>
          </section>
        )}

        {/* Allowance pending */}
        {allowancePending.length > 0 && (
          <section>
            <SectionHeader>Allowance</SectionHeader>
            <InsetList>
              {allowancePending.map((a: any, i: number) => (
                <ListRow
                  key={a.id}
                  icon={Wallet}
                  glyphColor="budget"
                  title={`$${a.amount.toFixed(2)} → ${a.to_user?.name || '—'}`}
                  subtitle={a.reason || 'Pending payment'}
                  showChevron
                  href="/dashboard/allowance"
                  last={i === allowancePending.length - 1}
                />
              ))}
            </InsetList>
          </section>
        )}

        {/* Upcoming birthdays / anniversaries */}
        {anniversaries.length > 0 && (
          <section>
            <SectionHeader>Coming up</SectionHeader>
            <InsetList>
              {anniversaries.slice(0, 3).map((a: any, i: number) => {
                const isBirthday = a.type === 'birthday'
                const Icon = isBirthday ? Cake : Calendar
                return (
                  <ListRow
                    key={a.id}
                    icon={Icon}
                    glyphColor="family"
                    title={a.name}
                    subtitle={a._days === 0 ? 'Today!' : a._days === 1 ? 'Tomorrow' : `In ${a._days} days`}
                    showChevron
                    href="/dashboard/anniversaries"
                    last={i === Math.min(anniversaries.length, 3) - 1}
                  />
                )
              })}
            </InsetList>
          </section>
        )}
      </div>
    </div>
  )
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}