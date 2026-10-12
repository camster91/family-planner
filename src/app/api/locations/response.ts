import { NextResponse, type NextResponse as NextResponseType } from 'next/server'

/** The public location shape deliberately excludes coordinates, timestamps and family internals. */
export const LOCATION_SELECT = {
  id: true,
  label: true,
  address: true,
  is_primary: true,
  user_id: true,
  user: { select: { id: true, name: true, avatar_url: true } },
} as const

export function toLocationResponse(location: {
  id: string
  label: string
  address: string | null
  is_primary: boolean
  user_id: string
  user: { id: string; name: string; avatar_url: string | null }
}) {
  return {
    id: location.id,
    label: location.label,
    address: location.address,
    is_primary: location.is_primary,
    user_id: location.user_id,
    user_name: location.user.name,
    user_avatar: location.user.avatar_url,
  }
}

export function locationJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export function withLocationNoStore<T extends NextResponseType>(response: T): T {
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
