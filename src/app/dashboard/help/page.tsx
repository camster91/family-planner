import type { Metadata } from 'next'
import { SUPPORT_EMAIL } from '@/lib/support'
import HelpContent from './HelpContent'

export const metadata: Metadata = { title: 'Help' }

/** Help and support for beta families (#146). Content: ./HelpContent.tsx. */
export default function HelpPage() {
  return <HelpContent supportEmail={SUPPORT_EMAIL} />
}
