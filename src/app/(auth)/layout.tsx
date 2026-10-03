import { BrandIllustration } from '@/components/ui/brand-illustration'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'

/**
 * Sign-in, sign-up and password pages. From md up, the Warm Paper entryway
 * art fills the left column beside the form. On phones there is no art at
 * all: the form comes first, and the hidden image is lazy, so it is never
 * downloaded there.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="md:grid md:min-h-screen md:grid-cols-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="relative hidden overflow-hidden bg-[var(--brand-cream)] md:block">
        <BrandIllustration
          source={ILLUSTRATIONS.authEntryway}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
