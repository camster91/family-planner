// Small, focused AI capture layer.
//
// Design intent: this is NOT a general assistant. Each capability below has one
// tight prompt and one known output shape. A cheap model is sufficient because
// the task is extraction, not reasoning.
//
// Provider configuration lives PER FAMILY in the app (Settings → AI capture),
// not in the server environment. The family's key is stored encrypted; see
// src/lib/secret-box.ts. Works with any OpenAI-compatible endpoint.
//
// A server-level CAPTURE_AI_KEY still works as a fallback so the deployment can
// be configured centrally if ever needed, but the app path is the default.
// The server key is only ever sent to the server-configured endpoint: a family
// without its own key cannot redirect it with a custom base URL.
// If neither is set, capture reports itself unavailable and the rest of the app
// is unaffected.

import { decryptSecret } from './secret-box'
import { assertPublicProviderUrl } from './outbound-url'

// Errors whose message is safe to show to the user. Anything else is reported
// generically so upstream response bodies never reach the client.
export class CaptureError extends Error {
  constructor(message: string, readonly status: number = 502) {
    super(message)
  }
}

const DEFAULT_MODEL = 'deepseek-chat'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'

// Resolved provider settings for one family.
export interface CaptureConfig {
  apiKey: string
  baseUrl: string
  model: string
  // True when baseUrl came from the family's settings and must be vetted
  // before the server connects to it.
  userSuppliedUrl: boolean
}

export type CaptureKind = 'event' | 'task' | 'listitem'

export interface CaptureDraft {
  kind: CaptureKind
  title: string
  start_time?: string // ISO, events/tasks
  end_time?: string // ISO, optional
  location?: string
  event_type?: 'school' | 'sports' | 'appointment' | 'family' | 'work' | 'other'
  list_name?: string // for listitem
  confidence: 'high' | 'medium' | 'low'
  note?: string // shown to the user when the model is unsure
}

// Per-family row shape we need from the database. Kept structural so this file
// does not import prisma directly.
export interface CaptureSettingsRow {
  capture_ai_key_enc?: string | null
  capture_ai_base_url?: string | null
  capture_ai_model?: string | null
}

// Prisma returns `undefined` for unselected columns, so a plain object of the
// three fields (or null) is all this accepts.
type CaptureSettingsInput = CaptureSettingsRow | null | undefined

// Build the effective config for a family, falling back to the deployment-level
// environment only if the family has not set anything.
export function resolveCaptureConfig(row?: CaptureSettingsInput): CaptureConfig | null {
  const familyKey = decryptSecret(row?.capture_ai_key_enc)
  const envBaseUrl = process.env.CAPTURE_AI_BASE_URL?.trim() || DEFAULT_BASE_URL
  const envModel = process.env.CAPTURE_AI_MODEL?.trim() || DEFAULT_MODEL

  if (familyKey) {
    return {
      apiKey: familyKey,
      baseUrl: (row?.capture_ai_base_url?.trim() || envBaseUrl).replace(/\/$/, ''),
      model: row?.capture_ai_model?.trim() || envModel,
      userSuppliedUrl: Boolean(row?.capture_ai_base_url?.trim()),
    }
  }

  const envKey = process.env.CAPTURE_AI_KEY?.trim() || null
  if (!envKey) return null

  // Deployment key: deployment endpoint and model only.
  return {
    apiKey: envKey,
    baseUrl: envBaseUrl.replace(/\/$/, ''),
    model: envModel,
    userSuppliedUrl: false,
  }
}

// Kept for the GET /api/capture health probe (deployment-level only).
export function isCaptureConfigured(): boolean {
  return Boolean(process.env.CAPTURE_AI_KEY)
}

function todayContext(): string {
  const now = new Date()
  const tz = process.env.TZ || 'America/Toronto'
  const weekday = now.toLocaleDateString('en-CA', { weekday: 'long', timeZone: tz })
  const iso = now.toISOString().slice(0, 10)
  const local = now.toLocaleString('en-CA', { timeZone: tz })
  return `Today is ${weekday}, ${iso} (${tz}). Current local time: ${local}.`
}

const SYSTEM_PROMPT = `You turn short family phrases into structured calendar entries.

You ALWAYS reply with a single JSON object and nothing else. No prose, no markdown fences.

Shape:
{
  "kind": "event" | "task" | "listitem",
  "title": string,
  "start_time": string | null,   // ISO 8601 local time, e.g. "2026-09-22T15:00:00"
  "end_time": string | null,
  "location": string | null,
  "event_type": "school" | "sports" | "appointment" | "family" | "work" | "other",
  "list_name": string | null,
  "confidence": "high" | "medium" | "low",
  "note": string | null
}

Rules:
- "event" = something happening at a time. "task" = something to be done by a date
  (homework, chore, deadline). "listitem" = something to buy or restock.
- Resolve relative dates ("Tuesday", "tomorrow", "next Friday") against the date given
  in the user message. Never invent a date you cannot derive — if the phrase has no
  time or date at all for an event, still return it with start_time null and
  confidence "low".
- If a duration is implied but not stated, leave end_time null.
- Keep the title short and human ("Dentist", not "Dentist appointment for Jack").
- Set confidence honestly: "low" when you guessed a date or the phrase is ambiguous.
- Put any uncertainty in "note" as one short plain sentence.`

// Screenshot/photo variant. Same discipline, different source and output shape.
const IMAGE_PROMPT = `You read a photo or screenshot (a school flyer, timetable, newsletter,
handout or appointment card) and extract the family events it contains.

You ALWAYS reply with a single JSON object and nothing else. No prose, no markdown fences.

Shape:
{
  "events": [
    {
      "title": string,
      "start_time": string | null,  // ISO 8601 local time
      "end_time": string | null,
      "location": string | null,
      "event_type": "school" | "sports" | "appointment" | "family" | "work" | "other"
    }
  ],
  "confidence": "high" | "medium" | "low",
  "note": string | null
}

Rules:
- Extract every distinct dated event you can see. If several dates belong to one series
  (e.g. a weekly club), return ONE event for the next occurrence, not all of them.
- Read dates carefully. If the year is absent, assume the current year unless that date
  would be in the past, in which case assume next year.
- If you cannot read a date, still include the event with start_time null.
- Never invent events that are not in the image.
- If the image has no dated events at all, return an empty events array and say so
  briefly in "note".
- Keep titles short and human.
- Set confidence honestly: "low" if the image was hard to read or the dates ambiguous.`

async function callModel(
  config: CaptureConfig,
  userContent: Array<Record<string, unknown>>,
  systemPrompt: string
): Promise<unknown> {
  const { apiKey, baseUrl, model } = config

  if (config.userSuppliedUrl) {
    try {
      await assertPublicProviderUrl(baseUrl)
    } catch (err) {
      throw new CaptureError(err instanceof Error ? err.message : 'The provider URL is not allowed', 400)
    }
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    // Never follow redirects: a provider could bounce the request (and the
    // Authorization header) to an internal address.
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0,
      // Ask for JSON where the provider supports it; harmless where it does not.
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    // Log the detail server-side only; the client gets the status code.
    console.warn(`Capture model failed (${res.status}): ${detail.slice(0, 200)}`)
    throw new CaptureError(`The AI provider returned an error (${res.status}). Check the key and provider in Settings.`)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = data.choices?.[0]?.message?.content
  if (!raw) throw new CaptureError('The AI provider returned no content')

  // Tolerate stray fences even though we asked for bare JSON.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    throw new CaptureError('The AI provider returned an unreadable answer')
  }
}

// Public entry point used by the API route.
export async function draftFromText(text: string, config: CaptureConfig): Promise<CaptureDraft> {
  const trimmed = text.trim()
  if (!trimmed) throw new CaptureError('Nothing to capture', 400)
  if (trimmed.length > 500) throw new CaptureError('Phrase is too long (max 500 characters)', 400)

  const parsed = await callModel(
    config,
    [
      { type: 'text', text: `${todayContext()}\n\nPhrase: ${trimmed}` },
    ],
    SYSTEM_PROMPT
  )

  const d = parsed as Partial<CaptureDraft>
  if (!d || typeof d.title !== 'string' || !d.title.trim()) {
    throw new CaptureError('The AI provider returned no usable title')
  }

  const kinds: CaptureKind[] = ['event', 'task', 'listitem']
  const kind = kinds.includes(d.kind as CaptureKind) ? (d.kind as CaptureKind) : 'event'

  return {
    kind,
    title: d.title.trim().slice(0, 200),
    start_time: d.start_time || undefined,
    end_time: d.end_time || undefined,
    location: d.location || undefined,
    event_type: d.event_type || 'other',
    list_name: d.list_name || undefined,
    confidence: d.confidence === 'high' || d.confidence === 'medium' ? d.confidence : 'low',
    note: d.note || undefined,
  }
}

// Screenshot capture: read a flyer/timetable image and extract its events.
// Returns proposals only — nothing is saved here.
export interface ImageEventProposal {
  title: string
  start_time?: string
  end_time?: string
  location?: string
  event_type?: 'school' | 'sports' | 'appointment' | 'family' | 'work' | 'other'
}

export interface ImageCaptureResult {
  events: ImageEventProposal[]
  confidence: 'high' | 'medium' | 'low'
  note?: string
}

export async function draftFromImage(
  base64: string,
  mimeType: string,
  config: CaptureConfig
): Promise<ImageCaptureResult> {
  if (!base64) throw new CaptureError('No image provided', 400)

  // Guard the payload size. ~6MB of base64 is roughly a 4.5MB image, which is
  // generous for a photo of a flyer and keeps the model call bounded.
  if (base64.length > 6_000_000) throw new CaptureError('Image is too large (max ~4.5MB)', 400)

  const parsed = await callModel(
    config,
    [
      {
        type: 'text',
        text: `${todayContext()}\n\nExtract the dated events from this image.`,
      },
      {
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${base64}` },
      },
    ],
    IMAGE_PROMPT
  )

  const d = parsed as Partial<ImageCaptureResult>
  const rawEvents = Array.isArray(d?.events) ? d.events : []

  const events: ImageEventProposal[] = rawEvents
    .filter((e) => e && typeof e.title === 'string' && e.title.trim())
    .slice(0, 20)
    .map((e) => ({
      title: e.title.trim().slice(0, 200),
      start_time: e.start_time || undefined,
      end_time: e.end_time || undefined,
      location: e.location || undefined,
      event_type: e.event_type || 'other',
    }))

  return {
    events,
    confidence: d?.confidence === 'high' || d?.confidence === 'medium' ? d.confidence : 'low',
    note: d?.note || undefined,
  }
}
