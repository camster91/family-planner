import { type NextRequest } from 'next/server'
import { postMessage } from '@/lib/message-create-http'
export const dynamic = 'force-dynamic'
/** Unknown older servers cannot silently strip required owner preconditions. */
export async function POST(request: NextRequest) { return postMessage(request, true) }
