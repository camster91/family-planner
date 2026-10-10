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
          <BrandMark size={48} className="h-12 w-12" />
          <span>{PRODUCT_BRAND.wordmark}</span>
        </Link>
      </header>
      <aside className="auth-art" aria-hidden="true">
        <BrandIllustration source={ILLUSTRATIONS.wovenGrove} className="woven-grove-art absolute inset-x-0 top-1/2 h-auto w-full -translate-y-1/2" />
        <div className="auth-art-caption"><p>{PRODUCT_BRAND.tagline}</p></div>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  )
}
