'use client'

import { useState, useEffect } from 'react'
import { Users, Plus, Settings, Heart, LayoutGrid, UserMinus } from 'lucide-react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { LargeHeader } from '@/components/ui/large-header'
import { InsetList, ListRow, SectionHeader } from '@/components/ui/list-row'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog } from '@/components/ui/dialog'
import { useFeatures } from '@/components/providers/features-provider'
import { isFeatureEnabled } from '@/lib/features'
import { MORE_HREF, moreItemsFor } from '@/lib/nav-items'

/**
 * Family tab (#269): members, then the household's other places — Emergency
 * (moved here from its own tab) and More (every other feature that is on).
 * Parent-only page (kid allowlist). Colour marks people (avatars), not roles.
 * "Remove from household" (O-34): a parent removes another member after a
 * confirm step (DELETE /api/family/members/[id]); never shown on their own row.
 */

type Member = { id: string; name: string; role?: string; avatar_url?: string | null; email?: string }

export default function FamilyPage() {
  const [familyMembers, setFamilyMembers] = useState<Member[]>([])
  const [myId, setMyId] = useState('')
  const [removing, setRemoving] = useState<Member | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [familyName, setFamilyName] = useState('')
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading] = useState(true)
  const { features } = useFeatures()
  const emergencyOn = isFeatureEnabled(features, 'emergency')
  // Chores and Emergency have their own rows; count what else More holds.
  const moreCount = moreItemsFor('parent', features).filter((i) => i.key !== 'chores' && i.key !== 'emergency').length

  useEffect(() => {
    loadFamilyData()
  }, [])

  const loadFamilyData = async () => {
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (!meRes.ok || !meData.user) return

      const user = meData.user
      setUserRole(user.role || '')
      setMyId(user.id || '')
      if (user.family) setFamilyName(user.family.name || '')

      if (!user.family_id) return

      const membersRes = await fetch('/api/family/members')
      const membersData = await membersRes.json()
      if (membersRes.ok && membersData.members) {
        setFamilyMembers(membersData.members)
      }
    } catch (err) {
      console.error('Error loading family data:', err)
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
        setRemoveError(typeof data.error === 'string' ? data.error : 'Could not remove them. Please try again.')
        return
      }
      setFamilyMembers((current) => current.filter((m) => m.id !== removing.id))
      setNotice(
        `${removing.name} was removed from the household.` +
          (data.tabletsRevoked > 0 ? ' Tablets they set up were signed out; a parent can pair them again.' : '')
      )
      setRemoving(null)
    } catch {
      setRemoveError('Could not remove them. Check your connection and try again.')
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <div className="pb-20">
      <LargeHeader
        title={familyName || 'Your Family'}
        subtitle={`${familyMembers.length} member${familyMembers.length !== 1 ? 's' : ''}`}
        className="px-4"
      />

      {/* Action buttons */}
      <div className="flex gap-3 px-4 mb-6">
        <Link href="/dashboard/family/invite" className="btn-tinted flex-1 justify-center">
          <Plus className="w-4 h-4" />
          <span>Add Member</span>
        </Link>
        <Link href="/dashboard/family/settings" className="btn-secondary flex items-center gap-2">
          <Settings className="w-4 h-4" />
          <span>Settings</span>
        </Link>
      </div>

      {/* Members list */}
      <div className="px-4">
        {notice && (
          <p role="status" className="mb-3 rounded-[var(--radius-md)] bg-[var(--surface-secondary)] px-4 py-3 text-[15px] text-label-primary">
            {notice}
          </p>
        )}
        {loading ? (
          <div className="text-center py-12">
            <div className="text-subhead text-label-secondary">Loading…</div>
          </div>
        ) : familyMembers.length === 0 ? (
          <EmptyState
            icon={Users}
            glyphColor="family"
            title="No family members yet"
            description="Invite family members to join your family and start organizing together."
            action={
              <Link href="/dashboard/family/invite" className="btn-tinted">
                <Plus className="w-4 h-4" />
                <span>Invite Members</span>
              </Link>
            }
          />
        ) : (
          <InsetList>
            {familyMembers.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <Avatar name={member.name} src={member.avatar_url} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-body text-label-primary font-medium truncate">
                      {member.name}
                    </span>
                    {member.role && (
                      <span className="px-2 py-0.5 rounded-full text-caption-1 font-medium bg-[var(--surface-secondary)] text-label-secondary">
                        {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
                      </span>
                    )}
                  </div>
                  <div className="text-footnote text-label-secondary truncate">{member.email}</div>
                </div>
                {canRemove(member) && (
                  <button
                    type="button"
                    onClick={() => {
                      setRemoveError(null)
                      setNotice(null)
                      setRemoving(member)
                    }}
                    className="btn-plain min-h-[44px] min-w-[44px] shrink-0 text-[var(--danger-text)]"
                    aria-label={`Remove ${member.name} from household`}
                  >
                    <UserMinus className="w-5 h-5" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only text-[15px]">Remove</span>
                  </button>
                )}
              </div>
            ))}
          </InsetList>
        )}
      </div>

      <Dialog
        open={removing !== null}
        onClose={removeBusy ? undefined : () => setRemoving(null)}
        title={removing ? `Remove ${removing.name}?` : 'Remove member?'}
        description="They will be signed out everywhere and can no longer see this household. Their account is not deleted. Chores they had not finished go to you to hand on; everything else stays with the household."
      >
        {removeError && (
          <p
            role="alert"
            className="mb-4 rounded-[var(--radius-md)] bg-[var(--danger-tint)] px-4 py-3 text-[15px] text-[var(--danger-text)]"
          >
            {removeError}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setRemoving(null)}
            disabled={removeBusy}
            className="btn-ghost min-h-[44px] flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmRemove}
            disabled={removeBusy}
            className="btn-destructive min-h-[44px] flex-1 disabled:opacity-40"
          >
            {removeBusy ? 'Removing…' : 'Remove from household'}
          </button>
        </div>
      </Dialog>

      <section className="px-4 mt-6" aria-labelledby="family-household">
        <SectionHeader>
          <span id="family-household">Household</span>
        </SectionHeader>
        <InsetList>
          {emergencyOn && (
            <ListRow
              icon={Heart}
              glyphColor="plain"
              title="Emergency"
              subtitle="Contacts and medical info for everyone"
              href="/dashboard/emergency"
            />
          )}
          <ListRow
            icon={LayoutGrid}
            glyphColor="plain"
            title="More"
            subtitle={
              moreCount === 0
                ? 'Chores and features you turn on'
                : `Chores and ${moreCount} more feature${moreCount === 1 ? '' : 's'}`
            }
            href={MORE_HREF}
            last
          />
        </InsetList>
      </section>
    </div>
  )
}
