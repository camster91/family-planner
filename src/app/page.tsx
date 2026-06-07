'use client'

import { CheckCircle, Wallet, ShoppingCart, Calendar, FolderKanban, MessageSquare, Shield, Star, Zap, ArrowRight, Users } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from '@/i18n'
import { Glyph } from '@/components/ui/glyph'
import { trackEvent } from '@/lib/analytics'

const FEATURES = [
  {
    color: 'chore' as const,
    icon: <CheckCircle className="w-7 h-7 text-white" />,
    titleKey: 'landing.choreTrackingTitle',
    descKey: 'landing.choreTrackingDesc',
  },
  {
    color: 'budget' as const,
    icon: <Wallet className="w-7 h-7 text-white" />,
    titleKey: 'landing.budgetTitle',
    descKey: 'landing.budgetDesc',
  },
  {
    color: 'lists' as const,
    icon: <ShoppingCart className="w-7 h-7 text-white" />,
    titleKey: 'landing.listsTitle',
    descKey: 'landing.listsDesc',
  },
  {
    color: 'calendar' as const,
    icon: <Calendar className="w-7 h-7 text-white" />,
    titleKey: 'landing.calendarTitle',
    descKey: 'landing.calendarDesc',
  },
  {
    color: 'projects' as const,
    icon: <FolderKanban className="w-7 h-7 text-white" />,
    titleKey: 'landing.projectsTitle',
    descKey: 'landing.projectsDesc',
  },
  {
    color: 'messages' as const,
    icon: <MessageSquare className="w-7 h-7 text-white" />,
    titleKey: 'landing.messagingTitle',
    descKey: 'landing.messagingDesc',
  },
] as const

const TRUST_BADGES = [
  { icon: <Shield className="w-4 h-4" />, label: 'Privacy First' },
  { icon: <Star className="w-4 h-4" />, label: 'Free Forever' },
  { icon: <Zap className="w-4 h-4" />, label: 'Any Device' },
]

export default function Home() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative">
        <div className="container mx-auto px-4 pt-16 pb-12 md:pt-24 md:pb-16">
          <div className="max-w-2xl mx-auto text-center">
            <h1 className="text-large-title mb-4">
              {t('landing.heroTitle')}
            </h1>
            <p className="text-[17px] leading-6 text-[var(--label-secondary)] mb-8">
              {t('landing.heroDescription')}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href="/register"
                onClick={() => trackEvent('cta_click', { location: 'hero_primary', label: 'Start Free' })}
                className="btn-filled"
              >
                {t('landing.startFreeTrial')}
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/login"
                onClick={() => trackEvent('cta_click', { location: 'hero_secondary', label: 'Sign In' })}
                className="btn-plain"
              >
                {t('landing.signIn')}
              </Link>
            </div>

            {/* Trust badges inline */}
            <div className="flex items-center justify-center gap-6 mt-6">
              {TRUST_BADGES.map((badge) => (
                <div key={badge.label} className="flex items-center gap-1.5 text-[13px] text-[var(--label-tertiary)]">
                  {badge.icon}
                  <span>{badge.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features — 3x2 glyph card grid */}
      <section className="py-8">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-title-2 text-center mb-6">
              {t('landing.featuresTitle')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 stagger">
              {FEATURES.map((feature) => (
                <div key={feature.titleKey} className="card-apple p-5 flex flex-col items-center text-center gap-3">
                  <Glyph color={feature.color} size="lg">
                    {feature.icon}
                  </Glyph>
                  <div>
                    <h3 className="text-[15px] font-semibold text-[var(--label-primary)] mb-1">
                      {t(feature.titleKey)}
                    </h3>
                    <p className="text-[13px] text-[var(--label-secondary)] leading-4">
                      {t(feature.descKey)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-title-2 text-center mb-8">
              {t('landing.howItWorksTitle')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 stagger">
              {[
                { num: '1', title: t('landing.step1Title'), desc: t('landing.step1Desc') },
                { num: '2', title: t('landing.step2Title'), desc: t('landing.step2Desc') },
                { num: '3', title: t('landing.step3Title'), desc: t('landing.step3Desc') },
              ].map((step) => (
                <div key={step.num} className="flex flex-col items-center text-center gap-2">
                  <div className="w-10 h-10 rounded-full bg-[var(--accent-fill)] flex items-center justify-center">
                    <span className="text-[17px] font-semibold text-white">{step.num}</span>
                  </div>
                  <h3 className="text-[15px] font-semibold text-[var(--label-primary)]">{step.title}</h3>
                  <p className="text-[13px] text-[var(--label-secondary)] leading-4">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="max-w-xl mx-auto text-center">
            <h2 className="text-title-2 mb-2">{t('landing.ctaTitle')}</h2>
            <p className="text-[15px] text-[var(--label-secondary)] mb-6">
              {t('landing.ctaSubtitle')}
            </p>
            <Link
              href="/register"
              onClick={() => trackEvent('cta_click', { location: 'bottom_cta', label: 'Get Started' })}
              className="btn-filled"
            >
              {t('landing.ctaPrimary')}
              <ArrowRight className="w-4 h-4" />
            </Link>
            <p className="mt-3 text-[13px] text-[var(--label-tertiary)]">
              {t('landing.ctaDisclaimer')}
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-6 border-t border-[var(--surface-separator)]">
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-[var(--accent-fill)] rounded-[8px] flex items-center justify-center">
                <Users className="w-4 h-4 text-white" />
              </div>
              <span className="text-[15px] font-semibold text-[var(--label-primary)]">Family Planner</span>
            </div>
            <nav className="flex gap-6 text-[13px] text-[var(--label-secondary)]">
              <Link href="/login" className="hover:text-[var(--label-primary)] transition-colors">Sign In</Link>
              <Link href="/register" className="hover:text-[var(--label-primary)] transition-colors">Get Started</Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}