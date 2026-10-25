import { type NextRequest } from 'next/server'
import { postMessageAttachment } from '@/lib/message-attachment-http'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export async function POST(request: NextRequest) { return postMessageAttachment(request, true) }
