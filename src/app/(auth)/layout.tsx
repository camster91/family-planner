import Link from 'next/link'
import { BrandIllustration, BrandMark } from '@/components/ui/brand-illustration'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'
import { PRODUCT_BRAND } from '@/lib/brand'

/** One shared frame, including recovery and verification states. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-layout">
      <header className="auth-brand-header">
        <Link href="/" aria-label={PRODUCT_BRAND.homeLabel} className="brand-wordmark min-h-[44px]">
          <BrandMark size={36} className="h-9 w-9" />
          <span>{PRODUCT_BRAND.name}</span>
        </Link>
      </header>
      <aside className="auth-art" aria-hidden="true">
        <BrandIllustration source={ILLUSTRATIONS.authEntryway} className="absolute inset-0 h-full w-full object-cover" />
        <div className="auth-art-caption"><p>{PRODUCT_BRAND.tagline}</p></div>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  )
}
