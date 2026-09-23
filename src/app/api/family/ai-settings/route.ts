import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireParent } from '@/lib/api-auth'
import { encryptSecret, decryptSecret, maskSecret } from '@/lib/secret-box'

export const dynamic = 'force-dynamic'

// GET /api/family/ai-settings — is a key stored, and which provider/model?
// Parents only. The key itself is NEVER returned, only a masked hint.
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) return error

  const parentError = requireParent(auth.user.role)
  if (parentError) return parentError

  const family = await prisma!.family.findUnique({
    where: { id: auth.user.family_id },
    select: {
      capture_ai_key_enc: true,
      capture_ai_base_url: true,
      capture_ai_model: true,
    },
  })

  const plain = decryptSecret(family?.capture_ai_key_enc)

  return NextResponse.json({
    configured: Boolean(plain),
    keyHint: plain ? maskSecret(plain) : null,
    baseUrl: family?.capture_ai_base_url ?? '',
    model: family?.capture_ai_model ?? '',
  })
}

// POST /api/family/ai-settings — save the key/provider.
// Body: { apiKey?: string, baseUrl?: string, model?: string, clear?: boolean }
// Parents only. An empty/omitted apiKey leaves the stored key untouched, so the
// form can change the model without re-entering the key.
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const parentError = requireParent(auth.user.role)
    if (parentError) return parentError

    const body = await request.json().catch(() => ({}))

    // Clearing removes the key and the provider overrides.
    if (body?.clear === true) {
      await prisma!.family.update({
        where: { id: auth.user.family_id },
        data: {
          capture_ai_key_enc: null,
          capture_ai_base_url: null,
          capture_ai_model: null,
        },
      })
      return NextResponse.json({ configured: false, keyHint: null, baseUrl: '', model: '' })
    }

    const rawKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : ''
    const model = typeof body?.model === 'string' ? body.model.trim() : ''

    // Light validation. We do not call the provider here — that would make
    // saving depend on a third party being reachable; the first capture is the
    // real test, and its errors are surfaced to the user.
    if (rawKey && rawKey.length < 12) {
      return NextResponse.json({ error: 'That key looks too short' }, { status: 400 })
    }
    if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json(
        { error: 'The provider URL must start with http:// or https://' },
        { status: 400 }
      )
    }

    const data: Record<string, string | null> = {
      capture_ai_base_url: baseUrl || null,
      capture_ai_model: model || null,
    }
    // Only overwrite the key when a new one was actually typed.
    if (rawKey) {
      data.capture_ai_key_enc = encryptSecret(rawKey)
    }

    const updated = await prisma!.family.update({
      where: { id: auth.user.family_id },
      data,
      select: {
        capture_ai_key_enc: true,
        capture_ai_base_url: true,
        capture_ai_model: true,
      },
    })

    const plain = decryptSecret(updated.capture_ai_key_enc)
    return NextResponse.json({
      configured: Boolean(plain),
      keyHint: plain ? maskSecret(plain) : null,
      baseUrl: updated.capture_ai_base_url ?? '',
      model: updated.capture_ai_model ?? '',
    })
  } catch (error) {
    console.error('AI settings error:', error)
    return NextResponse.json({ error: 'Could not save those settings' }, { status: 500 })
  }
}
