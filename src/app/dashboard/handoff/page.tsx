'use client'

import * as React from 'react'
import { Plus, Pencil, Trash2, Printer, Link2, Copy, Share2, RefreshCw } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslation } from '@/i18n'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useHandoffText } from '@/i18n/handoff'
import { useHandoffRecoveryText } from '@/i18n/handoff-recovery'
import { isoToLocalDateTimeInput, localDateTimeToISO } from '@/lib/dates'
import { canShareAppLink, shareAppLink } from '@/lib/native-app'
import { useDisplayLocale } from '@/components/ui/use-display-locale'

// D2 (#102): the API returns every field to parents, everything except the
// share token to teens, and only id/sitter_name/arrival_time/departure_time to
// children. Every other field is therefore optional here, and the card renders
// only what is present.
interface Handoff {
  id: string
  sitter_name: string
  sitter_phone?: string | null
  arrival_time: string | null
  departure_time: string | null
  kids_bedtimes?: string | null
  where_snacks?: string | null
  pickup_authorized?: string | null
  code_words?: string | null
  pet_care?: string | null
  emergency_notes?: string | null
  house_notes?: string | null
  general_notes?: string | null
  share_token?: string
  share_expires_at?: string | null
  created_at?: string
}

interface HandoffFormData {
  sitter_name: string
  sitter_phone: string
  arrival_time: string
  departure_time: string
  kids_bedtimes: string
  where_snacks: string
  pickup_authorized: string
  code_words: string
  pet_care: string
  emergency_notes: string
  house_notes: string
  general_notes: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function parseHandoff(value: unknown): Handoff | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.sitter_name !== 'string' ||
    !isNullableString(value.arrival_time) ||
    !isNullableString(value.departure_time)
  ) {
    return null
  }

  const nullableFields = [
    'sitter_phone',
    'kids_bedtimes',
    'where_snacks',
    'pickup_authorized',
    'code_words',
    'pet_care',
    'emergency_notes',
    'house_notes',
    'general_notes',
    'share_expires_at',
  ] as const
  if (nullableFields.some((field) => field in value && !isNullableString(value[field]))) return null
  const optionalStringFields = ['share_token', 'created_at'] as const
  if (optionalStringFields.some((field) => field in value && typeof value[field] !== 'string')) return null

  return {
    id: value.id,
    sitter_name: value.sitter_name,
    sitter_phone: value.sitter_phone as string | null | undefined,
    arrival_time: value.arrival_time,
    departure_time: value.departure_time,
    kids_bedtimes: value.kids_bedtimes as string | null | undefined,
    where_snacks: value.where_snacks as string | null | undefined,
    pickup_authorized: value.pickup_authorized as string | null | undefined,
    code_words: value.code_words as string | null | undefined,
    pet_care: value.pet_care as string | null | undefined,
    emergency_notes: value.emergency_notes as string | null | undefined,
    house_notes: value.house_notes as string | null | undefined,
    general_notes: value.general_notes as string | null | undefined,
    share_token: value.share_token as string | undefined,
    share_expires_at: value.share_expires_at as string | null | undefined,
    created_at: value.created_at as string | undefined,
  }
}

function parseHandoffList(value: unknown): Handoff[] | null {
  if (!isRecord(value) || !Array.isArray(value.handoffs)) return null
  const handoffs = value.handoffs.map(parseHandoff)
  return handoffs.every((handoff): handoff is Handoff => handoff !== null) ? handoffs : null
}

function emptyForm(): HandoffFormData {
  return {
    sitter_name: '',
    sitter_phone: '',
    arrival_time: '',
    departure_time: '',
    kids_bedtimes: '',
    where_snacks: '',
    pickup_authorized: '',
    code_words: '',
    pet_care: '',
    emergency_notes: '',
    house_notes: '',
    general_notes: '',
  }
}

function handoffToForm(h: Handoff): HandoffFormData {
  return {
    sitter_name: h.sitter_name,
    sitter_phone: h.sitter_phone ?? '',
    // Stored instants back to the parent's local wall-clock time (O-31).
    arrival_time: h.arrival_time ? isoToLocalDateTimeInput(h.arrival_time) : '',
    departure_time: h.departure_time ? isoToLocalDateTimeInput(h.departure_time) : '',
    kids_bedtimes: h.kids_bedtimes ?? '',
    where_snacks: h.where_snacks ?? '',
    pickup_authorized: h.pickup_authorized ?? '',
    code_words: h.code_words ?? '',
    pet_care: h.pet_care ?? '',
    emergency_notes: h.emergency_notes ?? '',
    house_notes: h.house_notes ?? '',
    general_notes: h.general_notes ?? '',
  }
}

/**
 * A labelled field. The label is tied to the control with `htmlFor`/`id`, so
 * the control is passed as a render function that receives the id.
 */
function FormField({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = React.useId()
  return (
    <div>
      <label htmlFor={id} className="block text-caption-1 text-label-secondary mb-1">
        {label}
      </label>
      {children(id)}
    </div>
  )
}

function Input({
  id,
  value,
  onChange,
  type = 'text',
  placeholder,
  className,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  className?: string
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${className ?? ''}`}
    />
  )
}

function Textarea({
  id,
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
    />
  )
}

function HandoffForm({
  mode,
  initial,
  onSave,
  onDelete,
  t,
  saving,
  error,
  formId,
  showActions = true,
}: {
  mode: 'add' | 'edit'
  initial?: Handoff
  onSave: (data: HandoffFormData) => void
  onDelete?: () => void
  t: (key: string) => string
  saving: boolean
  error?: string | null
  formId?: string
  showActions?: boolean
}) {
  const [form, setForm] = React.useState<HandoffFormData>(initial ? handoffToForm(initial) : emptyForm())

  const set = (key: keyof HandoffFormData, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(form)
  }

  return (
    <form id={formId} onSubmit={handleSubmit}>
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="bg-[var(--tint-rewards)]/20 border border-[var(--tint-rewards)]/30 rounded-xl px-4 py-3 text-subhead text-[var(--tint-rewards)]"
          >
            {error}
          </div>
        )}
        <FormField label={t('handoff.sitterName')}>
          {(id) => <Input id={id} value={form.sitter_name} onChange={(v) => set('sitter_name', v)} placeholder="e.g. Sarah" />}
        </FormField>
        <FormField label={t('handoff.sitterPhone')}>
          {(id) => (
            <Input
              id={id}
              value={form.sitter_phone}
              onChange={(v) => set('sitter_phone', v)}
              type="tel"
              placeholder="(555) 123-4567"
            />
          )}
        </FormField>
        <FormField label={t('handoff.arrivalTime')}>
          {(id) => (
            <Input id={id} value={form.arrival_time} onChange={(v) => set('arrival_time', v)} type="datetime-local" />
          )}
        </FormField>
        <FormField label={t('handoff.departureTime')}>
          {(id) => (
            <Input id={id} value={form.departure_time} onChange={(v) => set('departure_time', v)} type="datetime-local" />
          )}
        </FormField>
        <FormField label={t('handoff.kidsBedtimes')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.kids_bedtimes}
              onChange={(v) => set('kids_bedtimes', v)}
              placeholder="e.g. Emma: 8pm, Max: 8:30pm"
              rows={2}
            />
          )}
        </FormField>
        <FormField label={t('handoff.whereSnacks')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.where_snacks}
              onChange={(v) => set('where_snacks', v)}
              placeholder="e.g. Snacks in the pantry, fruit in the fridge"
              rows={2}
            />
          )}
        </FormField>
        <FormField label={t('handoff.pickupAuthorized')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.pickup_authorized}
              onChange={(v) => set('pickup_authorized', v)}
              placeholder="e.g. Grandma Jane, Uncle Bob"
              rows={2}
            />
          )}
        </FormField>
        <FormField label={t('handoff.codeWords')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.code_words}
              onChange={(v) => set('code_words', v)}
              placeholder="e.g. Code word for emergencies: PINEAPPLE"
              rows={2}
            />
          )}
        </FormField>
        <FormField label={t('handoff.petCare')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.pet_care}
              onChange={(v) => set('pet_care', v)}
              placeholder="e.g. Dog: walk at 7pm, cat: no special care"
              rows={2}
            />
          )}
        </FormField>
        <FormField label={t('handoff.emergencyNotes')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.emergency_notes}
              onChange={(v) => set('emergency_notes', v)}
              placeholder="Allergies, medical info, emergency contacts..."
              rows={3}
            />
          )}
        </FormField>
        <FormField label={t('handoff.houseNotes')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.house_notes}
              onChange={(v) => set('house_notes', v)}
              placeholder="e.g. Thermostat, TV codes, alarm code..."
              rows={3}
            />
          )}
        </FormField>
        <FormField label={t('handoff.generalNotes')}>
          {(id) => (
            <Textarea
              id={id}
              value={form.general_notes}
              onChange={(v) => set('general_notes', v)}
              placeholder="Any other notes for the sitter..."
              rows={3}
            />
          )}
        </FormField>
      </div>
      {showActions && (
        <HandoffFormActions
          mode={mode}
          onDelete={onDelete}
          formId={formId}
          t={t}
          saving={saving}
        />
      )}
    </form>
  )
}

function HandoffFormActions({
  mode,
  onDelete,
  formId,
  t,
  saving,
}: {
  mode: 'add' | 'edit'
  onDelete?: () => void
  formId?: string
  t: (key: string) => string
  saving: boolean
}) {
  return (
    <div className="flex gap-2" data-testid="handoff-form-footer">
      {mode === 'edit' && onDelete && (
        <button
          type="button"
          disabled={saving}
          onClick={onDelete}
          className="min-h-[44px] px-3 py-2 rounded-lg text-danger-text text-subhead font-medium flex items-center gap-1.5 hover:bg-[var(--danger-tint)]"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
          {t('handoff.deleteHandoff')}
        </button>
      )}
      <button type="submit" form={formId} disabled={saving} className="btn-filled ml-auto min-h-[44px]">
        {saving ? t('common.saving') : t('common.save')}
      </button>
    </div>
  )
}

/** The sitter page link for a token. */
function shareUrl(token: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/handoff/${token}`
}

/** True while the stored share link still opens (the API fails closed on no expiry). */
function isShareLinkLive(handoff: Pick<Handoff, 'share_token' | 'share_expires_at'>, now: number = Date.now()) {
  if (!handoff.share_token || !handoff.share_expires_at) return false
  const expires = new Date(handoff.share_expires_at).getTime()
  return Number.isFinite(expires) && expires > now
}

/**
 * Share with the sitter. Shows the current link instead of making a new one on
 * every tap (a new link stops the one the sitter already has). Copy runs inside
 * the tap with no network wait first, which iOS Safari requires. A new link is
 * made only from an explicit "Make a new link" step that says the old one stops.
 */
function ShareLinkDialog({
  handoff,
  onClose,
  onMakeNewLink,
  making,
  displayLocale,
}: {
  handoff: Handoff | null
  onClose: () => void
  onMakeNewLink: () => void
  making: boolean
  displayLocale: string
}) {
  const { addToast } = useToast()
  const { t } = useTranslation()
  const text = useHandoffRecoveryText()
  const [confirmingReset, setConfirmingReset] = React.useState(false)
  const [canNativeShare, setCanNativeShare] = React.useState(false)
  const urlId = React.useId()

  React.useEffect(() => {
    setCanNativeShare(canShareAppLink())
  }, [])

  // A fresh start each time the dialog opens or a new link arrives.
  const token = handoff?.share_token
  React.useEffect(() => {
    setConfirmingReset(false)
  }, [handoff?.id, token])

  if (!handoff) return null
  const live = isShareLinkLive(handoff)
  const url = live && token ? shareUrl(token) : null

  const copy = () => {
    if (!url) return
    // Called straight from the click, before any await.
    const write = navigator.clipboard?.writeText?.(url)
    if (!write) {
      addToast({ type: 'info', title: text('copyFallback') })
      return
    }
    write.then(
      () => addToast({ type: 'success', title: t('handoff.linkCopied') }),
      () => addToast({ type: 'error', title: text('copyFailed'), message: text('copyFailedMessage') })
    )
  }

  const nativeShare = () => {
    if (!url) return
    shareAppLink(text('nativeShareTitle', { name: handoff.sitter_name }), url)
      // Dismissing the share sheet rejects; that is not an error.
      .catch(() => undefined)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      closeLabel={text('shareClose')}
      title={t('handoff.shareWithSitter')}
      description={text('shareDescription', { name: handoff.sitter_name })}
      testId="handoff-share-dialog"
    >
      {url ? (
        <div className="space-y-3">
          <div>
            <label htmlFor={urlId} className="block text-caption-1 text-label-secondary mb-1">
              {text('sitterLink')}
            </label>
            <input
              id={urlId}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            {handoff.share_expires_at && (
              <p className="mt-1 text-caption-1 text-label-secondary">
                {text('worksUntil', { date: new Date(handoff.share_expires_at).toLocaleString(displayLocale) })}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="btn-filled flex-1">
              <Copy className="w-4 h-4" aria-hidden="true" />
              {t('handoff.copyLink')}
            </button>
            {canNativeShare && (
              <button type="button" onClick={nativeShare} className="btn-tinted min-h-[44px] flex-1">
                <Share2 className="w-4 h-4" aria-hidden="true" />
                {text('shareAction')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-subhead text-label-secondary">
          {handoff.share_token ? text('expired') : text('noLink')} {text('makeNewLinkPrompt')}
        </p>
      )}

      <div className="mt-6 border-t border-[var(--surface-separator)] pt-4">
        {url && !confirmingReset ? (
          <button
            type="button"
            onClick={() => setConfirmingReset(true)}
            className="btn-ghost min-h-[44px] w-full"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {text('makeNewLink')}
          </button>
        ) : url && confirmingReset ? (
          <div className="space-y-2" role="group" aria-label={text('makeNewLink')}>
            <p className="text-subhead text-label-primary">
              {text('confirmNewLink')}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingReset(false)}
                className="btn-ghost min-h-[44px] flex-1"
              >
                {text('keepCurrentLink')}
              </button>
              <button type="button" onClick={onMakeNewLink} disabled={making} className="btn-destructive flex-1 disabled:opacity-40">
                {making ? text('making') : text('makeLink')}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={onMakeNewLink} disabled={making} className="btn-filled w-full">
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            {making ? text('making') : text('makeNewLink')}
          </button>
        )}
      </div>
    </Dialog>
  )
}

// Icon-only card actions: a 44px tap area around a 20px glyph.
const ICON_BUTTON_CLASS =
  'inline-flex h-11 w-11 items-center justify-center rounded-lg text-label-secondary hover:bg-[var(--surface-secondary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]'

function HandoffCard({
  handoff,
  canManage,
  onEdit,
  onShare,
  onPrint,
  printing = false,
  t,
  displayLocale,
}: {
  handoff: Handoff
  /** Parents only: share link and edit. Teens and children get a read-only card. */
  canManage: boolean
  onEdit: () => void
  onShare: () => void
  onPrint: () => void
  /** This is the card being printed: the print stylesheet shows only it. */
  printing?: boolean
  t: (key: string) => string
  displayLocale: string
}) {
  return (
    <div
      className={`card-apple overflow-hidden${printing ? ' print-card' : ''}`}
      data-testid={`handoff-card-${handoff.id}`}
    >
      <div className="p-4 border-b border-[var(--surface-separator)]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-headline font-semibold text-label-primary">{handoff.sitter_name}</h2>
            {handoff.sitter_phone && (
              <p className="text-subhead text-label-secondary mt-0.5">{handoff.sitter_phone}</p>
            )}
          </div>
          <div className="flex gap-1 no-print">
            {canManage && (
              <button
                type="button"
                onClick={onShare}
                className={ICON_BUTTON_CLASS}
                title={t('handoff.shareWithSitter')}
                aria-label={t('handoff.shareWithSitter')}
              >
                <Link2 className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onPrint}
              className={ICON_BUTTON_CLASS}
              title={t('handoff.print')}
              aria-label={t('handoff.print')}
            >
              <Printer className="w-5 h-5" aria-hidden="true" />
            </button>
            {canManage && (
              <button
                type="button"
                onClick={onEdit}
                className={ICON_BUTTON_CLASS}
                title={t('handoff.editHandoff')}
                aria-label={t('handoff.editHandoff')}
              >
                <Pencil className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="p-4 space-y-2 text-footnote">
        {handoff.arrival_time && (
          <div>
            <span className="text-label-tertiary">{t('handoff.arrivalTime')}: </span>
            <span className="text-label-primary font-medium">{new Date(handoff.arrival_time).toLocaleString(displayLocale)}</span>
          </div>
        )}
        {handoff.departure_time && (
          <div>
            <span className="text-label-tertiary">{t('handoff.departureTime')}: </span>
            <span className="text-label-primary font-medium">{new Date(handoff.departure_time).toLocaleString(displayLocale)}</span>
          </div>
        )}
        {handoff.kids_bedtimes && (
          <div>
            <span className="text-label-tertiary">{t('handoff.kidsBedtimes')}: </span>
            <span className="text-label-primary font-medium">{handoff.kids_bedtimes}</span>
          </div>
        )}
        {handoff.where_snacks && (
          <div>
            <span className="text-label-tertiary">{t('handoff.whereSnacks')}: </span>
            <span className="text-label-primary font-medium">{handoff.where_snacks}</span>
          </div>
        )}
        {handoff.pickup_authorized && (
          <div>
            <span className="text-label-tertiary">{t('handoff.pickupAuthorized')}: </span>
            <span className="text-label-primary font-medium">{handoff.pickup_authorized}</span>
          </div>
        )}
        {handoff.code_words && (
          <div>
            <span className="text-label-tertiary">{t('handoff.codeWords')}: </span>
            <span className="text-label-primary font-medium">{handoff.code_words}</span>
          </div>
        )}
        {handoff.pet_care && (
          <div>
            <span className="text-label-tertiary">{t('handoff.petCare')}: </span>
            <span className="text-label-primary font-medium">{handoff.pet_care}</span>
          </div>
        )}
        {handoff.emergency_notes && (
          <div>
            <span className="text-label-tertiary">{t('handoff.emergencyNotes')}: </span>
            <span className="text-label-primary font-medium">{handoff.emergency_notes}</span>
          </div>
        )}
        {handoff.house_notes && (
          <div>
            <span className="text-label-tertiary">{t('handoff.houseNotes')}: </span>
            <span className="text-label-primary font-medium">{handoff.house_notes}</span>
          </div>
        )}
        {handoff.general_notes && (
          <div>
            <span className="text-label-tertiary">{t('handoff.generalNotes')}: </span>
            <span className="text-label-primary font-medium">{handoff.general_notes}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function HandoffPage() {
  return (
    <FeatureGate featureKey="handoff">
      <HandoffPageInner />
    </FeatureGate>
  )
}

function HandoffPageInner() {
  const { t } = useTranslation()
  const displayLocale = useDisplayLocale()
  const [handoffs, setHandoffs] = React.useState<Handoff[]>([])
  const [loading, setLoading] = React.useState(true)
  // loadError: the list failed to load. error: the open modal's save/delete failed.
  // Keep this semantic so a locale change can update the visible copy without
  // making the canonical list request run again.
  const [loadError, setLoadError] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showAdd, setShowAdd] = React.useState(false)
  const [editHandoff, setEditHandoff] = React.useState<Handoff | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [userRole, setUserRole] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<Handoff | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<'failed' | 'network' | null>(null)
  const createHandoffRef = React.useRef<HTMLButtonElement>(null)
  const retryHandoffsRef = React.useRef<HTMLButtonElement>(null)
  const cancelDeleteRef = React.useRef<HTMLButtonElement>(null)
  const mutationRef = React.useRef(false)
  const handoffText = useHandoffText()
  const recoveryText = useHandoffRecoveryText()
  // The handoff whose share dialog is open, by id so a new link shows at once.
  const [shareId, setShareId] = React.useState<string | null>(null)
  const [makingLink, setMakingLink] = React.useState(false)
  const { addToast } = useToast()
  const shareHandoff = shareId ? (handoffs.find((h) => h.id === shareId) ?? null) : null

  const fetchHandoffs = React.useCallback(async () => {
    try {
      const res = await fetch('/api/handoff')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      const parsed = parseHandoffList(data)
      if (!parsed) throw new Error('Malformed handoff response')
      setHandoffs(parsed)
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Get user role
  React.useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setUserRole(d.user.role)
      })
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    fetchHandoffs()
  }, [fetchHandoffs])

  const retryHandoffs = () => {
    setLoading(true)
    void fetchHandoffs()
  }

  const handleSave = async (form: HandoffFormData) => {
    if (mutationRef.current) return
    mutationRef.current = true
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...form,
        // datetime-local values carry no offset, and a UTC server would read
        // them as UTC. Send the instant instead (O-31); an unparseable value
        // goes through as typed so the API rejects it.
        arrival_time: form.arrival_time ? (localDateTimeToISO(form.arrival_time) ?? form.arrival_time) : null,
        departure_time: form.departure_time
          ? (localDateTimeToISO(form.departure_time) ?? form.departure_time)
          : null,
      }
      if (editHandoff) {
        const res = await fetch(`/api/handoff/${editHandoff.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to update')
        }
      } else {
        const res = await fetch('/api/handoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || 'Failed to create')
        }
      }
      setShowAdd(false)
      setEditHandoff(null)
      await fetchHandoffs()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save handoff')
    } finally {
      mutationRef.current = false
      setSaving(false)
    }
  }

  const openDeleteConfirmation = () => {
    if (!editHandoff || mutationRef.current) return
    setDeleteError(null)
    setDeleteTarget(editHandoff)
  }

  const closeDeleteConfirmation = () => {
    if (mutationRef.current) return
    setDeleteError(null)
    setDeleteTarget(null)
  }

  const handleDelete = async () => {
    const handoff = deleteTarget
    if (!handoff || mutationRef.current) return
    mutationRef.current = true
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/handoff/${handoff.id}`, { method: 'DELETE' })
      if (!res.ok) {
        setDeleteError('failed')
        return
      }
      setDeleteTarget(null)
      setEditHandoff(null)
      setHandoffs((current) => current.filter((item) => item.id !== handoff.id))
      await fetchHandoffs()
      window.requestAnimationFrame(() => (retryHandoffsRef.current ?? createHandoffRef.current)?.focus())
    } catch {
      setDeleteError('network')
    } finally {
      mutationRef.current = false
      setDeleting(false)
    }
  }

  // Replaces the share token: the link the sitter already has stops working.
  // Only reached from the share dialog's explicit "Make new link" step.
  const handleMakeNewLink = async () => {
    if (!shareHandoff || makingLink || mutationRef.current) return
    const id = shareHandoff.id
    mutationRef.current = true
    setMakingLink(true)
    try {
      const res = await fetch(`/api/handoff/${id}/regenerate-token`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to regenerate')
      const data = await res.json()
      const updated = data.handoff as Handoff
      setHandoffs((prev) =>
        prev.map((h) =>
          h.id === id ? { ...h, share_token: updated.share_token, share_expires_at: updated.share_expires_at } : h
        )
      )
      addToast({ type: 'success', title: recoveryText('newLinkMade'), message: recoveryText('newLinkMadeMessage') })
    } catch {
      addToast({ type: 'error', title: recoveryText('newLinkFailed'), message: t('common.error') })
    } finally {
      mutationRef.current = false
      setMakingLink(false)
    }
  }

  // Printing marks the chosen card with `print-card` (the print stylesheet
  // hides everything else), then opens the print dialog once that class is on
  // the page. A fresh object per request lets the same card print twice even
  // if a browser never fires `afterprint`.
  const [printRequest, setPrintRequest] = React.useState<{ id: string } | null>(null)
  const handlePrint = (id: string) => setPrintRequest({ id })

  React.useEffect(() => {
    if (!printRequest) return
    const done = () => setPrintRequest(null)
    window.addEventListener('afterprint', done)
    window.print()
    return () => window.removeEventListener('afterprint', done)
  }, [printRequest])

  const closeModal = () => {
    if (mutationRef.current) return
    setShowAdd(false)
    setEditHandoff(null)
    setError(null)
  }

  const isParent = userRole === 'parent'

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-large-title font-display">{t('handoff.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('handoff.subtitle')}</p>
        </div>
        <div className="card-apple p-8 text-center">
          <p className="text-subhead text-label-secondary">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <style jsx global>{`
        @media print {
          @page { margin: 0.5in; size: letter; }
          body * { visibility: hidden; }
          .print-card, .print-card * { visibility: visible; }
          .print-card { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between no-print">
          <div>
            <h1 className="text-large-title font-display">{t('handoff.title')}</h1>
            <p className="text-subhead text-label-secondary mt-0.5">{t('handoff.subtitle')}</p>
          </div>
          {isParent && (
            <button
              ref={createHandoffRef}
              onClick={() => setShowAdd(true)}
              className="btn-filled px-4 py-2 rounded-lg text-subhead font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              {t('handoff.createHandoff')}
            </button>
          )}
        </div>

        {loadError && (
          <div className="card-apple p-4 text-center text-label-secondary" role="alert">
            <p>{t('handoff.errorLoad')}</p>
            <button ref={retryHandoffsRef} type="button" onClick={retryHandoffs} className="btn-tinted mt-3 min-h-[44px]">
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              {t('routeState.tryAgain')}
            </button>
          </div>
        )}

        {!loadError && handoffs.length === 0 && (
          <EmptyState
            glyphColor="family"
            title={t('handoff.empty')}
            description={t('handoff.emptySubtitle')}
            action={
              isParent ? (
                <button
                  onClick={() => setShowAdd(true)}
                  className="btn-filled px-4 py-2 rounded-lg text-subhead font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  {t('handoff.createHandoff')}
                </button>
              ) : undefined
            }
          />
        )}

        <div className="space-y-4">
          {handoffs.map((h) => (
            <HandoffCard
              key={h.id}
              handoff={h}
              canManage={isParent}
              onEdit={() => setEditHandoff(h)}
              onShare={() => setShareId(h.id)}
              onPrint={() => handlePrint(h.id)}
              printing={printRequest?.id === h.id}
              t={t}
              displayLocale={displayLocale}
            />
          ))}
        </div>
      </div>

      <Dialog
        open={isParent && showAdd && !editHandoff}
        onClose={saving || deleting ? undefined : closeModal}
        closeLabel={recoveryText('formClose')}
        title={t('handoff.createHandoff')}
        variant="form"
        footer={
          <HandoffFormActions
            mode="add"
            formId="handoff-create-form"
            t={t}
            saving={saving || deleting}
          />
        }
      >
        <HandoffForm
          mode="add"
          formId="handoff-create-form"
          onSave={handleSave}
          t={t}
          saving={saving || deleting}
          error={error}
          showActions={false}
        />
      </Dialog>

      <Dialog
        open={isParent && !!editHandoff}
        onClose={saving || deleting ? undefined : closeModal}
        closeLabel={recoveryText('formClose')}
        title={t('handoff.editHandoff')}
        variant="form"
        footer={
          <HandoffFormActions
            mode="edit"
            formId="handoff-edit-form"
            onDelete={openDeleteConfirmation}
            t={t}
            saving={saving || deleting}
          />
        }
      >
        {isParent && editHandoff && (
          <HandoffForm
            mode="edit"
            formId="handoff-edit-form"
            initial={editHandoff}
            onSave={handleSave}
            onDelete={openDeleteConfirmation}
            t={t}
            saving={saving || deleting}
            error={error}
            showActions={false}
          />
        )}
      </Dialog>

      {deleteTarget && (
        <Dialog
          open
          role="alertdialog"
          testId="remove-handoff-dialog"
          title={handoffText('deleteTitle', { name: deleteTarget.sitter_name })}
          description={handoffText('deleteDescription', { name: deleteTarget.sitter_name })}
          initialFocusRef={cancelDeleteRef}
          onClose={deleting ? undefined : closeDeleteConfirmation}
          closeLabel={handoffText('deleteClose')}
        >
          <div aria-busy={deleting}>
            {deleteError && (
              <p role="alert" className="mb-4 text-sm text-danger-text">
                {deleteError === 'network'
                  ? handoffText('deleteNetworkError')
                  : handoffText('deleteFailed')}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                ref={cancelDeleteRef}
                type="button"
                disabled={deleting}
                onClick={closeDeleteConfirmation}
                className="min-h-[44px] min-w-[44px] rounded-lg border border-input px-4 text-foreground disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="btn-destructive min-h-[44px] min-w-[44px] px-4 disabled:opacity-60"
              >
                {deleting
                  ? handoffText('deleting')
                  : deleteError
                    ? t('routeState.tryAgain')
                    : t('common.delete')}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {isParent && (
        <ShareLinkDialog
          handoff={shareHandoff}
          onClose={() => setShareId(null)}
          onMakeNewLink={handleMakeNewLink}
          making={makingLink}
          displayLocale={displayLocale}
        />
      )}
    </>
  )
}
