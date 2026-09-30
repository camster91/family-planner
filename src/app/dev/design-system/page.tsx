import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import DesignGallery from './DesignGallery'
import { isDesignGalleryEnabled } from './gate'
import { parseGalleryOptions } from './options'

/**
 * /dev/design-system — protected development gallery (#156,
 * docs/design/DESIGN_GALLERY.md).
 *
 * 404 in a production build unless DESIGN_GALLERY_ENABLED=1 (the E2E server
 * sets it; a production deployment never does). Dynamic so the flag is read
 * per request, not frozen at build time. No session, database or API access:
 * every component gets fixture props from ./fixtures.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Design gallery',
  robots: { index: false, follow: false },
}

export default async function DesignGalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (!isDesignGalleryEnabled()) notFound()
  const options = parseGalleryOptions(await searchParams)
  return <DesignGallery options={options} />
}
