'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import CalendarSubscriptionsSection from './CalendarSubscriptionsSection'
import CalendarSyncSection from './CalendarSyncSection'
import SharedDeviceSettings from './SharedDeviceSettings'
import DeleteAccountDialog from '@/components/account/DeleteAccountDialog'
import { Dialog } from '@/components/ui/dialog'
import { downloadMyData } from '@/lib/data-export-client'
import { DEFAULT_THEME, applyThemePreference, readThemePreference, writeThemePreference, type ThemePreference } from '@/lib/theme'
import { isLocale, useTranslation } from '@/i18n'
import NotificationPreferences from '@/components/account/NotificationPreferences'
import BetaMetricsSwitch from '@/components/account/BetaMetricsSwitch'
import SettingsDisclosure from './SettingsDisclosure'
import SettingsIcon from './SettingsIcon'
import {
  Save,
  Bell,
  User,
  Moon,
  Globe,
  KeyRound,
  Sliders,
  Database,
  CalendarDays,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  History,
  Home,
  Users,
  UserPlus,
  TabletSmartphone,
  Download,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

/** Who is looking at Settings; decided on the server from the database role. */
export type SettingsViewerRole = 'parent' | 'teen'

const rowClass =
  'flex min-h-[44px] w-full items-center gap-3 rounded-lg p-3 text-left text-foreground hover:bg-muted'

/** One of the three Settings groups: Your account, Family, Privacy & data. */
function SettingsGroup({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="px-1 text-xl font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function CardHeader({
  icon,
  tone,
  title,
  description,
}: {
  icon: LucideIcon
  tone: React.ComponentProps<typeof SettingsIcon>['tone']
  title: string
  description?: string
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <SettingsIcon icon={icon} tone={tone} />
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold text-foreground">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}

/**
 * Settings, in three groups (one primary action per card):
 * 1. Your account: profile, password, language, theme, notifications.
 * 2. Family (parents only): household links, family tablet, calendar feed,
 *    subscriptions and sync, AI capture. Long, rarely used parts start closed.
 * 3. Privacy & data: data export, beta usage counts (parents), delete account.
 *
 * `viewerRole` is decided on the server (./page.tsx). A teen (O-37) gets only
 * their personal sections: profile, notifications and quiet hours, theme,
 * language, password, their own data export and account deletion. Every
 * family-level section (AI capture, calendar feed, subscriptions and sync,
 * Features, imports, Recent changes, tablets and the Tablet PIN, beta usage
 * counts) is parent-only: it is not rendered and its data is never fetched.
 *
 * `aiCaptureSettings` (server-decided) shows the AI capture key form: off
 * unless CAPTURE_AI_SETTINGS_ENABLED is on or the household already saved a
 * key. While it is off the form is not rendered and its API is not called.
 *
 * `sharedDevice` is null unless the shared-device kill switch is on AND the
 * viewer is a parent. `betaMetrics` (#287) is the household's beta usage
 * counts switch, read on the server for a parent only (null otherwise, and the
 * switch is not shown).
 */
export default function SettingsClient({
  viewerRole,
  sharedDevice,
  betaMetrics = null,
  calendarSync = false,
  aiCaptureSettings = false,
}: {
  viewerRole: SettingsViewerRole
  sharedDevice: { hasPin: boolean } | null
  betaMetrics?: { enabled: boolean } | null
  calendarSync?: boolean
  aiCaptureSettings?: boolean
}) {
  const isParent = viewerRole === 'parent'
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [age, setAge] = useState('')
  // Auto (follow the device) unless this device saved a choice (O-43). Read
  // after mount: localStorage does not exist on the server.
  const [theme, setTheme] = useState<ThemePreference>(DEFAULT_THEME)

  useEffect(() => {
    setTheme(readThemePreference())
  }, [])

  // Saved only when the person picks one, so opening Settings never turns
  // the default (Auto) into a stored choice.
  const chooseTheme = (next: ThemePreference) => {
    setTheme(next)
    writeThemePreference(next)
    applyThemePreference(next)
  }
  const { locale, setLocale, t } = useTranslation()
  const themeLabels = {
    light: t('preferences.themeLight'),
    dark: t('preferences.themeDark'),
    auto: t('preferences.themeAuto'),
  }
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)

  // Calendar feed state. Parents only — the API enforces that too.
  const [feedToken, setFeedToken] = useState<string | null>(null)
  const [feedBusy, setFeedBusy] = useState(false)
  const [feedCopied, setFeedCopied] = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)

  // AI capture provider state. The key is never loaded back into the form —
  // the API returns only a masked hint, so the field stays empty on load.
  const [aiKey, setAiKey] = useState('')
  const [aiKeyHint, setAiKeyHint] = useState<string | null>(null)
  const [aiConfigured, setAiConfigured] = useState(false)
  const [aiBaseUrl, setAiBaseUrl] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  const feedUrl =
    feedToken && typeof window !== 'undefined'
      ? `${window.location.origin}/api/calendar/feed?token=${feedToken}`
      : ''
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  // Data export and account deletion (docs/product/ACCOUNT_DELETION.md).
  const [exportState, setExportState] = useState<'idle' | 'working' | 'error'>('idle')
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const handleExport = async () => {
    setExportState('working')
    try {
      await downloadMyData()
      setExportState('idle')
    } catch {
      setExportState('error')
    }
  }

  // Load user data
  useEffect(() => {
    loadUserData()
  }, [])

  // Which server build is running (GET /api/version: { version, commit, builtAt }).
  // Purely informational, so any failure just leaves the line out.
  const [build, setBuild] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/version')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || typeof d.version !== 'string' || !d.version || d.version === 'unknown') return
        const commit = typeof d.commit === 'string' && d.commit !== 'unknown' ? d.commit.slice(0, 7) : ''
        setBuild(commit ? `${d.version} (${commit})` : d.version)
      })
      .catch(() => {})
  }, [])

  // Load the family's calendar feed token, if one exists. Parents only — the
  // API refuses everyone else too.
  useEffect(() => {
    if (!isParent) return
    fetch('/api/family/feed-token')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.feedToken === 'string' && d.feedToken) setFeedToken(d.feedToken)
      })
      .catch(() => {})
  }, [isParent])

  // Load AI capture settings (masked hint only — never the key itself). Parents
  // only, and only while the form is shown (see aiCaptureSettings).
  const showAi = isParent && aiCaptureSettings
  useEffect(() => {
    if (!showAi) return
    fetch('/api/family/ai-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        setAiConfigured(Boolean(d.configured))
        setAiKeyHint(d.keyHint ?? null)
        setAiBaseUrl(d.baseUrl ?? '')
        setAiModel(d.model ?? '')
      })
      .catch(() => {})
  }, [showAi])

  const saveAiSettings = async (clear = false) => {
    setAiBusy(true)
    setAiError(null)
    setAiMessage(null)
    try {
      const res = await fetch('/api/family/ai-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          clear
            ? { clear: true }
            : { apiKey: aiKey.trim(), baseUrl: aiBaseUrl.trim(), model: aiModel.trim() }
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not save those settings')
      setAiConfigured(Boolean(data.configured))
      setAiKeyHint(data.keyHint ?? null)
      setAiKey('')
      setAiMessage(clear ? 'AI key removed' : 'Saved')
      setTimeout(() => setAiMessage(null), 2500)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Could not save those settings')
    } finally {
      setAiBusy(false)
    }
  }

  // Create the token, or regenerate it to revoke the old link.
  const handleFeedToken = async (regenerate: boolean) => {
    setFeedBusy(true)
    setFeedError(null)
    try {
      const res = await fetch('/api/family/feed-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.feedToken) {
        throw new Error(data.error || 'Could not create the link')
      }
      setFeedToken(data.feedToken)
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : 'Could not create the link')
    } finally {
      setFeedBusy(false)
    }
  }

  const copyFeedUrl = async () => {
    if (!feedUrl) return
    try {
      await navigator.clipboard.writeText(feedUrl)
      setFeedCopied(true)
      setTimeout(() => setFeedCopied(false), 2000)
    } catch {
      setFeedError('Could not copy. Select the link and copy it manually.')
    }
  }

  const loadUserData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      const data = await res.json()

      if (res.ok && data.user) {
        setName(data.user.name || '')
        setEmail(data.user.email || '')
        setRole(data.user.role || '')
        setAge(data.user.age?.toString() || '')
      }
    } catch (err) {
      console.error('Error loading user data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          age: age ? parseInt(age) : null,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        // Show the server's reason (for example "Age must be between 1 and 150").
        setMessage({ type: 'error', text: data.error || 'Failed to update profile. Please try again.' })
        return
      }

      setMessage({ type: 'success', text: 'Profile updated successfully!' })
      // The nav avatar initials and name come from the server layout.
      router.refresh()
    } catch (err) {
      console.error('Error saving profile:', err)
      setMessage({ type: 'error', text: 'Failed to update profile. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fields = new FormData(e.currentTarget)
    const currentPassword = String(fields.get('currentPassword') ?? '')
    const newPassword = String(fields.get('newPassword') ?? '')
    const confirmNewPassword = String(fields.get('confirmNewPassword') ?? '')
    setPasswordError(null)

    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }

    setChangingPassword(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to change password')

      setPasswordSuccess(true)
      setTimeout(() => {
        setShowPasswordModal(false)
        setPasswordSuccess(false)
      }, 2000)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
        <p className="mt-4 text-muted-foreground">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <div>
        <h1 className="text-large-title text-label-primary">Settings</h1>
        <p className="mt-2 text-muted-foreground">
          {isParent ? 'Your account, your family and your data.' : 'Your account and your data.'}
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-md ${
          message.type === 'success' ? 'bg-[var(--success-tint)] text-foreground border border-[var(--success)]' : 'bg-[var(--danger-tint)] text-danger-text border border-[var(--danger-tint)]'
        }`}>
          {message.text}
        </div>
      )}

      {/* 1. Your account: personal to whoever is signed in (parent or teen). */}
      <SettingsGroup id="settings-account" title="Your account">
        <div className="card">
          <CardHeader icon={User} tone="blue" title="Profile" />

          <form onSubmit={handleSaveProfile} className="space-y-5">
            <div>
              <label htmlFor="profileName" className="block text-sm font-medium text-foreground mb-2">
                Full Name
              </label>
              <input
                id="profileName"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                placeholder="Your name"
              />
            </div>
            <div>
              <label htmlFor="profileAge" className="block text-sm font-medium text-foreground mb-2">
                Age <span className="font-normal text-label-tertiary">(optional)</span>
              </label>
              <input
                id="profileAge"
                type="number"
                min="1"
                max="120"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="input-field"
                placeholder="Your age"
              />
            </div>
            {/* Read-only facts: email changes go through support, roles through a parent. */}
            <dl className="space-y-1 text-sm text-muted-foreground">
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-medium text-foreground">Email</dt>
                <dd className="min-w-0 break-words">{email}</dd>
              </div>
              {role && (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-foreground">Role</dt>
                  <dd className="capitalize">{role}</dd>
                </div>
              )}
            </dl>

            <button type="submit" disabled={saving} className="btn-primary inline-flex items-center min-h-[44px]">
              <Save className="w-4 h-4 mr-2" aria-hidden="true" />
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </form>
        </div>

        <div className="card">
          <CardHeader icon={KeyRound} tone="red" title="Password" description="Change the password you sign in with" />
          <button type="button" onClick={() => setShowPasswordModal(true)} className="btn-secondary min-h-[44px]">
            Change Password
          </button>
        </div>

        <div className="card">
          <CardHeader icon={Globe} tone="green" title={t('preferences.language')} />
          <label htmlFor="preferredLanguage" className="sr-only">{t('preferences.preferredLanguage')}</label>
          <select
            id="preferredLanguage"
            value={locale}
            onChange={(e) => {
              // Saved on this device by the root I18nProvider; applies at once.
              if (isLocale(e.target.value)) setLocale(e.target.value)
            }}
            className="input-field w-full"
          >
            <option value="en">{t('preferences.languageEnglish')}</option>
            <option value="es">{t('preferences.languageSpanish')}</option>
          </select>
        </div>

        <div className="card">
          <CardHeader icon={Moon} tone="purple" title={t('preferences.theme')} description={t('preferences.themeDescription')} />
          <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('preferences.theme')}>
            {(['light', 'dark', 'auto'] as const).map((themeOption) => (
              <button
                key={themeOption}
                type="button"
                onClick={() => chooseTheme(themeOption)}
                aria-pressed={theme === themeOption}
                className={`min-h-[44px] rounded-lg border-2 px-2 py-2 text-center font-medium text-foreground ${
                  theme === themeOption ? 'border-primary bg-[var(--accent-tint)]' : 'border-border hover:border-input'
                }`}
              >
                {themeLabels[themeOption]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-label-tertiary">{t('preferences.themeAutoHint')}</p>
        </div>

        <div className="card">
          <CardHeader
            icon={Bell}
            tone="yellow"
            title="Notifications"
            description="Choose what you hear about. Each switch saves straight away."
          />
          {/* Saved on your account (#286), so it follows you to every device. */}
          <NotificationPreferences />
        </div>
      </SettingsGroup>

      {/* 2. Family: household-level, parents only. Not rendered for a teen and
          none of its data is fetched (the APIs refuse teens regardless). */}
      {isParent && (
        <SettingsGroup id="settings-family" title="Family">
          <div className="card">
            <div className="-mx-3 space-y-1">
              <Link href="/dashboard/family/settings" className={rowClass}>
                <Home className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <div className="font-medium">Household</div>
                  <div className="text-xs text-label-tertiary">Family name and the fridge board</div>
                </div>
              </Link>
              <Link href="/dashboard/family" className={rowClass}>
                <Users className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <div className="font-medium">Members</div>
                  <div className="text-xs text-label-tertiary">See and manage who is in your family</div>
                </div>
              </Link>
              <Link href="/dashboard/family/invite" className={rowClass}>
                <UserPlus className="w-4 h-4 shrink-0 text-success-text" aria-hidden="true" />
                <div>
                  <div className="font-medium">Invite and family code</div>
                  <div className="text-xs text-label-tertiary">Add a parent, teen or child</div>
                </div>
              </Link>
              <Link href="/dashboard/features" className={rowClass}>
                <Sliders className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <div className="font-medium">Features</div>
                  <div className="text-xs text-label-tertiary">Turn modules on or off (meals, notes, pickups, allowance…)</div>
                </div>
              </Link>
              <Link href="/dashboard/settings/imports" className={rowClass}>
                <Database className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <div className="font-medium">Import family apps</div>
                  <div className="text-xs text-label-tertiary">Bring in ChoreChamps, Meal Planner or Budget App exports</div>
                </div>
              </Link>
              {/* Household audit history, #285. The page and API are parent-only too. */}
              <Link href="/dashboard/settings/activity" className={rowClass}>
                <History className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
                <div>
                  <div className="font-medium">Recent changes</div>
                  <div className="text-xs text-label-tertiary">Who changed features, invites, the Today board or tablets</div>
                </div>
              </Link>
            </div>
          </div>

          {/* Shared tablets (#241): only while the kill switch is on (decided in ./page.tsx). */}
          {sharedDevice && (
            <div className="card">
              <CardHeader icon={TabletSmartphone} tone="blue" title="Family tablet" />
              <div className="-mx-3 space-y-1">
                <SharedDeviceSettings initialHasPin={sharedDevice.hasPin} />
              </div>
            </div>
          )}

          {/* Calendar feed: a household link (API-enforced parent-only). */}
          <SettingsDisclosure
            title="Calendar feed"
            description="See your family calendar in Google, Apple or Outlook"
            icon={<SettingsIcon icon={CalendarDays} tone="sky" />}
            forceOpen={Boolean(feedError)}
          >
            {feedToken ? (
              <div className="space-y-4">
                <div>
                  <label htmlFor="feedUrl" className="block text-sm font-medium text-foreground mb-2">
                    Your private link
                  </label>
                  <input
                    id="feedUrl"
                    readOnly
                    value={feedUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="input-field w-full text-xs font-mono"
                  />
                  <p className="text-xs text-label-tertiary mt-2">
                    Anyone with this link can read your family calendar. Keep it private.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button onClick={copyFeedUrl} className="btn-primary inline-flex items-center min-h-[44px]">
                    {feedCopied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                    {feedCopied ? 'Copied' : 'Copy link'}
                  </button>
                  <button
                    onClick={() => handleFeedToken(true)}
                    disabled={feedBusy}
                    className="inline-flex items-center min-h-[44px] px-4 py-2 rounded-lg border border-input text-foreground hover:bg-muted"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${feedBusy ? 'animate-spin' : ''}`} />
                    Reset link
                  </button>
                </div>

                <p className="text-xs text-label-tertiary">
                  Resetting makes a new link and instantly stops the old one working.
                </p>

                <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
                  <div className="font-medium text-foreground mb-1">How to add it</div>
                  <div>Google Calendar: Other calendars then From URL, paste the link.</div>
                  <div>Apple Calendar: File then New Calendar Subscription, paste the link.</div>
                  <div>Outlook: Add calendar then Subscribe from web, paste the link.</div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Create a private link so your family calendar shows up in the calendar app you already use.
                </p>
                <button
                  onClick={() => handleFeedToken(false)}
                  disabled={feedBusy}
                  className="btn-primary inline-flex items-center min-h-[44px]"
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${feedBusy ? 'animate-spin' : ''}`} />
                  {feedBusy ? 'Creating...' : 'Create feed link'}
                </button>
              </div>
            )}

            {feedError && <p className="text-sm text-danger-text mt-3">{feedError}</p>}
          </SettingsDisclosure>

          {/* Subscribed (read-only ICS) calendars, #232. The API enforces parent-only too. */}
          <CalendarSubscriptionsSection />

          {/* Two-way Google/Outlook sync, #264. Hidden unless the server has it configured. */}
          {calendarSync && <CalendarSyncSection />}

          {/* AI capture: the household's provider key. Only when the deployment
              turns the form on, or a key is already saved (so it can be removed). */}
          {aiCaptureSettings && (
            <SettingsDisclosure
              title="AI capture"
              description="Type a sentence or photograph a flyer, and it sorts itself out"
              icon={<SettingsIcon icon={Sparkles} tone="violet" />}
              forceOpen={Boolean(aiError)}
            >
              <div className="space-y-4">
                <div>
                  <label htmlFor="aiKey" className="block text-sm font-medium text-foreground mb-2">
                    API key
                  </label>
                  <input
                    id="aiKey"
                    type="password"
                    autoComplete="off"
                    value={aiKey}
                    onChange={(e) => setAiKey(e.target.value)}
                    placeholder={aiConfigured ? `Saved: ${aiKeyHint}` : 'Paste your key'}
                    className="input-field w-full font-mono text-sm"
                  />
                  <p className="text-xs text-label-tertiary mt-2">
                    Stored encrypted. Never shown again after saving.
                  </p>
                </div>

                <div>
                  <label htmlFor="aiBaseUrl" className="block text-sm font-medium text-foreground mb-2">
                    Provider URL <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input
                    id="aiBaseUrl"
                    value={aiBaseUrl}
                    onChange={(e) => setAiBaseUrl(e.target.value)}
                    placeholder="https://generativelanguage.googleapis.com/v1beta/openai"
                    className="input-field w-full text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="aiModel" className="block text-sm font-medium text-foreground mb-2">
                    Model <span className="text-muted-foreground font-normal">(optional)</span>
                  </label>
                  <input
                    id="aiModel"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="gemini-2.0-flash"
                    className="input-field w-full text-sm"
                  />
                </div>

                <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3">
                  <div className="font-medium text-foreground mb-1">For photos of flyers, pick a vision model</div>
                  <div>Google Gemini Flash — free tier, reads photos. Use the URL and model above.</div>
                  <div>OpenAI — paste the key and leave URL and model blank.</div>
                  <div>DeepSeek — paste the key. Text only; photos will not work.</div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => saveAiSettings(false)}
                    disabled={aiBusy || (!aiKey.trim() && !aiConfigured)}
                    className="btn-primary inline-flex items-center min-h-[44px]"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {aiBusy ? 'Saving…' : 'Save'}
                  </button>
                  {aiConfigured && (
                    <button
                      onClick={() => saveAiSettings(true)}
                      disabled={aiBusy}
                      className="min-h-[44px] px-2 text-sm text-danger-text hover:underline"
                    >
                      Remove key
                    </button>
                  )}
                  {aiMessage && (
                    <span className="text-sm text-success-text inline-flex items-center">
                      <Check className="w-4 h-4 mr-1" /> {aiMessage}
                    </span>
                  )}
                </div>

                {aiError && <p className="text-sm text-danger-text">{aiError}</p>}
              </div>
            </SettingsDisclosure>
          )}
        </SettingsGroup>
      )}

      {/* 3. Privacy & data: a teen sees only their own export and deletion. */}
      <SettingsGroup id="settings-privacy" title="Privacy & data">
        <div className="card">
          <div className="-mx-3 space-y-1">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={exportState === 'working'}
              className={rowClass}
            >
              <Download className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <div className="font-medium">{exportState === 'working' ? 'Preparing your data…' : 'Data Export'}</div>
                <div className="text-xs text-label-tertiary">Download everything the app holds about you, in one file you can open or keep</div>
              </div>
            </button>
            {exportState === 'error' && (
              <p role="alert" className="px-3 text-sm text-danger-text">
                The download did not work. Try again.
              </p>
            )}
            {/* Beta usage counts (#287): parents only; PATCH /api/family/beta-metrics enforces it too. */}
            {isParent && betaMetrics && <BetaMetricsSwitch initialEnabled={betaMetrics.enabled} />}
            <button
              type="button"
              onClick={() => setShowDeleteDialog(true)}
              className={`${rowClass} !text-danger-text hover:bg-[var(--danger-tint)]`}
            >
              <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="font-medium">Delete Account</span>
            </button>
          </div>
        </div>
      </SettingsGroup>

      {/* App Info */}
      <div className="rounded-xl bg-muted p-5 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">Family Planner</p>
        {build && <p>Version {build}</p>}
        <p className="mt-1 text-label-tertiary">&copy; {new Date().getFullYear()} Family Planner. All rights reserved.</p>
      </div>

      {/* A teen deletes only their own account; the household option is a parent's. */}
      <DeleteAccountDialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} allowHousehold={isParent} />

      {/* Change Password Modal */}
      <Dialog
        open={showPasswordModal}
        onClose={() => { setShowPasswordModal(false); setPasswordError(null); setPasswordSuccess(false) }}
        title="Change Password"
      >
            {passwordSuccess ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-[var(--success-tint)] rounded-full flex items-center justify-center mx-auto mb-4">
                  <KeyRound className="w-8 h-8 text-success-text" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">Password Changed</h3>
                <p className="text-muted-foreground mt-2">Your password has been updated successfully.</p>
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                {passwordError && (
                  <div className="bg-[var(--danger-tint)] border border-[var(--danger-tint)] text-danger-text px-4 py-3 rounded-md">
                    {passwordError}
                  </div>
                )}
                <div>
                  <label htmlFor="currentPassword" className="block text-sm font-medium text-foreground mb-2">
                    Current Password
                  </label>
                  <input
                    id="currentPassword"
                    name="currentPassword"
                    type="password"
                    required
                    className="input-field"
                    autoComplete="current-password"
                  />
                </div>
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-foreground mb-2">
                    New Password
                  </label>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    required
                    className="input-field"
                    autoComplete="new-password"
                    minLength={8}
                  />
                  <p className="mt-1 text-xs text-label-tertiary">Must be at least 8 characters</p>
                </div>
                <div>
                  <label htmlFor="confirmNewPassword" className="block text-sm font-medium text-foreground mb-2">
                    Confirm New Password
                  </label>
                  <input
                    id="confirmNewPassword"
                    name="confirmNewPassword"
                    type="password"
                    required
                    className="input-field"
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex space-x-4 pt-4">
                  <button
                    type="button"
                    onClick={() => { setShowPasswordModal(false); setPasswordError(null) }}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changingPassword}
                    className="btn-primary flex-1"
                  >
                    {changingPassword ? 'Changing...' : 'Change Password'}
                  </button>
                </div>
              </form>
            )}
      </Dialog>
    </div>
  )
}
