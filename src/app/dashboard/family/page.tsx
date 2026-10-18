'use client'

import { useState, useEffect, useRef } from 'react'
import { Users, Plus, Settings, Heart, LayoutGrid, UserMinus } from 'lucide-react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { LargeHeader } from '@/components/ui/large-header'
import { InsetList, ListRow, SectionHeader } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog } from '@/components/ui/dialog'
import { useFeatures } from '@/components/providers/features-provider'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { MORE_HREF, moreItemsFor } from '@/lib/nav-items'
import { useMoreText } from '@/i18n/more'
import { useTranslation } from '@/i18n'
import { profileSetupMessages } from '@/i18n/profile-setup'
import { useFamilyOverviewText, type FamilyFeedback } from '@/i18n/family-overview'
import { useDisplayLocale } from '@/components/ui/use-display-locale'

/**
 * Family tab (#269): members, then the household's other places — Emergency
 * (moved here from its own tab) and More (every other feature that is on).
 * Parent-only page (kid allowlist). Colour marks people (avatars), not roles.
 * "Remove from household" (O-34): a parent removes another member after a
 * confirm step (DELETE /api/family/members/[id]); never shown on their own row.
 */

type Member = { id: string; name: string; role?: string | null; avatar_url?: string | null; email?: string | null }

function isMember(value: unknown): value is Member {
  if (value === null || typeof value !== 'object') return false
  const member = value as Record<string, unknown>
  return typeof member.id === 'string' && member.id.length > 0 && typeof member.name === 'string' &&
    ['role', 'avatar_url', 'email'].every((key) => member[key] == null || typeof member[key] === 'string')
}

function isMemberList(value: unknown): value is Member[] {
  return Array.isArray(value) && value.every(isMember) && new Set(value.map((member) => member.id)).size === value.length
}

export default function FamilyPage() {
  const more = useMoreText()
  const copy = useFamilyOverviewText()
  const { t } = useTranslation()
  const locale = useDisplayLocale()
  const rosterHeadingRef = useRef<HTMLHeadingElement>(null)
  const feedbackText = (value: FamilyFeedback) => 'raw' in value ? value.raw : copy(value.key, value.params)
  const roleText = (role: string) => {
    const key = role === 'parent' ? 'roleParent' : role === 'teen' ? 'roleTeen' : role === 'child' ? 'roleChild' : null
    return key ? t(key, undefined, profileSetupMessages) : role
  }
  const [familyMembers, setFamilyMembers] = useState<Member[]>([])
  const [myId, setMyId] = useState('')
  const [removing, setRemoving] = useState<Member | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<FamilyFeedback | null>(null)
  const [notice, setNotice] = useState<FamilyFeedback | null>(null)
  const [familyName, setFamilyName] = useState('')
  const [hasHousehold, setHasHousehold] = useState<boolean | null>(null)
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const { features } = useFeatures()
  const emergencyOn = isFeatureEnabled(features, 'emergency')
  // Chores and Emergency have their own rows; count what else More holds.
  const moreCount = moreItemsFor('parent', features).filter((i) => i.key !== 'chores' && i.key !== 'emergency' && i.key !== 'family').length

  useEffect(() => {
    loadFamilyData()
  }, [])

  useEffect(() => {
    if (!removing && notice) rosterHeadingRef.current?.focus()
  }, [removing, notice])

  const loadFamilyData = async () => {
    setLoading(true)
    setLoadError(false)
    setFamilyMembers([])
    setFamilyName('')
    setHasHousehold(null)
    setMyId('')
    setUserRole('')
    setNotice(null)
    setRemoving(null)
    setRemoveError(null)
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (!meRes.ok || !meData.user || typeof meData.user.id !== 'string' || !meData.user.id || (meData.user.role != null && typeof meData.user.role !== 'string')) {
        setLoadError(true)
        return
      }

      const user = meData.user
      setUserRole(user.role || '')
      setMyId(user.id || '')
      if (user.family_id == null || user.family_id === '') {
        setHasHousehold(false)
        return
      }
      if (typeof user.family_id !== 'string') {
        setLoadError(true)
        return
      }
      setHasHousehold(true)
      if (typeof user.family?.name === 'string') setFamilyName(user.family.name)

      const membersRes = await fetch('/api/family/members')
      const membersData = await membersRes.json()
      if (membersRes.ok && isMemberList(membersData.members)) {
        setFamilyMembers(membersData.members)
      } else {
        setLoadError(true)
      }
    } catch {
      // A failed load is shown on the page (below), not as "no members".
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  const parentCount = familyMembers.filter((m) => m.role === 'parent').length
  const canRemove = (member: Member) =>
    userRole === 'parent' && member.id !== myId && !(member.role === 'parent' && parentCount <= 1)

  const confirmRemove = async () => {
    if (!removing) return
    setRemoveBusy(true)
    setRemoveError(null)
    try {
      const res = await fetch(`/api/family/members/${encodeURIComponent(removing.id)}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRemoveError(typeof data.error === 'string' ? { raw: data.error } : { key: 'removeFailed' })
        return
      }
      setFamilyMembers((current) => current.filter((m) => m.id !== removing.id))
      setNotice({ key: data.tabletsRevoked > 0 ? 'removedWithTablets' : 'removed', params: { name: removing.name } })
      setRemoving(null)
    } catch {
      setRemoveError({ key: 'removeNetwork' })
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <LargeHeader
        title={familyName || copy('title')}
        subtitle={
          loading || loadError || !hasHousehold
            ? undefined
            : copy(familyMembers.length === 1 ? 'memberOne' : 'memberMany', { count: familyMembers.length.toLocaleString(locale) })
        }
      />

      {/* Action buttons */}
      {hasHousehold && !loadError && <div className="flex flex-wrap gap-3">
        <Link href="/dashboard/family/invite" className="btn-tinted min-h-[44px]">
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>{copy('addMember')}</span>
        </Link>
        <Link href="/dashboard/family/settings" className="btn-secondary flex items-center gap-2">
          <Settings className="w-4 h-4" aria-hidden="true" />
          <span>{copy('settings')}</span>
        </Link>
      </div>}

      {/* Members list */}
      <section aria-labelledby="family-members-heading" className="min-w-0">
        <h2 ref={rosterHeadingRef} id="family-members-heading" tabIndex={-1} className="mb-3 text-title-3 font-display outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] rounded-[var(--radius-sm)]">{copy('people')}</h2>
        {notice && (
          <p role="status" className="mb-3 rounded-[var(--radius-md)] bg-[var(--surface-secondary)] px-4 py-3 text-[15px] text-label-primary">
            {feedbackText(notice)}
          </p>
        )}
        {loading ? (
          <div role="status" className="text-center py-12">
            <div className="text-subhead text-label-secondary">{copy('loading')}</div>
          </div>
        ) : loadError ? (
          <div role="alert" className="card-apple p-5 flex flex-col items-start gap-3">
            <p className="text-headline text-label-primary">{copy('loadFailed')}</p>
            <p className="text-subhead text-label-secondary">{copy('retryDescription')}</p>
            <button type="button" onClick={() => void loadFamilyData()} className="btn-tinted min-h-[44px]">
              {copy('tryAgain')}
            </button>
          </div>
        ) : hasHousehold === false ? (
          <EmptyState
            icon={Users}
            glyphColor="family"
            title={copy('chooseHousehold')}
            description={copy('chooseHouseholdDescription')}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Link href="/dashboard/family/create" className="btn-tinted min-h-[44px]">{copy('createHousehold')}</Link>
                <Link href="/join" className="btn-secondary min-h-[44px]">{copy('joinHousehold')}</Link>
              </div>
            }
          />
        ) : familyMembers.length === 0 ? (
          <EmptyState
            icon={Users}
            glyphColor="family"
            title={copy('emptyTitle')}
            description={copy('emptyDescription')}
            action={
              <Link href="/dashboard/family/invite" className="btn-tinted">
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>{copy('inviteMembers')}</span>
              </Link>
            }
          />
        ) : (
          <ul className="grid min-w-0 grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="family-members">
            {familyMembers.map((member) => (
              <li key={member.id} className="card-apple min-w-0 p-4" data-testid="family-member" data-member-id={member.id}>
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar name={member.name} src={member.avatar_url} size="md" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-body text-label-primary font-semibold [overflow-wrap:anywhere]">{member.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-footnote text-label-secondary">
                      {member.role && <span>{roleText(member.role)}</span>}
                      {member.id === myId && <span className="rounded-full bg-[var(--surface-fill)] px-2 py-0.5">{copy('you')}</span>}
                    </div>
                    <p className="mt-3 text-footnote text-label-secondary">{copy('account')}</p>
                    {member.email && <p className="mt-0.5 text-subhead text-label-primary [overflow-wrap:anywhere]">{member.email}</p>}
                  </div>
                </div>
                {canRemove(member) && (
                  <button type="button" onClick={() => {
                    setRemoveError(null)
                    setNotice(null)
                    setRemoving(member)
                  }} className="btn-plain mt-3 min-h-[44px] min-w-[44px] text-[var(--danger-text)]" aria-label={copy('removeAria', { name: member.name })}>
                    <UserMinus className="w-4 h-4" aria-hidden="true" />
                    <span>{copy('remove')}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={removing !== null}
        onClose={removeBusy ? undefined : () => setRemoving(null)}
        title={removing ? copy('removeTitle', { name: removing.name }) : copy('removeTitleFallback')}
        closeLabel={copy('close')}
        description={copy('removeDescription')}
      >
        {removeError && (
          <p
            role="alert"
            className="mb-4 rounded-[var(--radius-md)] bg-[var(--danger-tint)] px-4 py-3 text-[15px] text-[var(--danger-text)]"
          >
            {feedbackText(removeError)}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setRemoving(null)}
            disabled={removeBusy}
            className="btn-ghost min-h-[44px] flex-1"
          >
            {copy('cancel')}
          </button>
          <button
            type="button"
            onClick={confirmRemove}
            disabled={removeBusy}
            className="btn-destructive min-h-[44px] flex-1 disabled:opacity-40"
          >
            {copy(removeBusy ? 'removing' : 'removeConfirm')}
          </button>
        </div>
      </Dialog>

      {hasHousehold && !loadError && <section className="min-w-0" aria-labelledby="family-household">
        <SectionHeader>
          <span id="family-household">{copy('household')}</span>
        </SectionHeader>
        <InsetList>
          {emergencyOn && (
            <ListRow
              icon={Heart}
              glyphColor="plain"
              title={copy('emergency')}
              subtitle={copy('emergencyDescription')}
              href="/dashboard/emergency"
            />
          )}
          <ListRow
            icon={LayoutGrid}
            glyphColor="plain"
            title={more('title')}
            subtitle={
              moreCount === 0
                ? copy('moreEmpty')
                : copy(moreCount === 1 ? 'moreOne' : 'moreMany', { count: moreCount.toLocaleString(locale) })
            }
            href={MORE_HREF}
            last
          />
        </InsetList>
      </section>}
    </div>
  )
}
