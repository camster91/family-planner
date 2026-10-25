import { NextRequest } from 'next/server'
import { postFamilyImport } from '@/lib/imports/family-import-http'
export const dynamic = 'force-dynamic'
export async function POST(request: NextRequest, context: { params: Promise<{ source: string }> }) {
  return postFamilyImport(request, context, true)
}
