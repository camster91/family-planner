'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { PRODUCT_BRAND } from '@/lib/brand'
import { BrandIllustration, BrandMark } from '@/components/ui/brand-illustration'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'

export default function Home() {
  const { t, locale } = useTranslation()
  return (
    <div className="marketing-page">
      <a href="#main-content" className="marketing-skip">{t('landing.skipContent')}</a>
      <header className="marketing-header marketing-width">
        <Link href="/" aria-label={PRODUCT_BRAND.homeLabel} className="brand-wordmark">
          <BrandMark size={48} className="h-12 w-12" />
          <span>{PRODUCT_BRAND.wordmark}</span>
        </Link>
        <nav aria-label={t('landing.mainNavigation')}>
          <Link href="#everyday" className="marketing-learn">{t('landing.seeDay')}</Link>
          <Link href="/login" className="btn-plain">{t('landing.signIn')}</Link>
        </nav>
      </header>
      <main id="main-content">
        <section className="marketing-hero marketing-width" aria-labelledby="hero-title">
          <div className="marketing-hero-copy">
            <p className="marketing-eyebrow">{t('landing.eyebrow')}</p>
            <h1 id="hero-title">{locale === 'en' ? PRODUCT_BRAND.tagline : t('landing.heroTitle')}</h1>
            <p className="marketing-intro">{t('landing.heroDescription')}</p>
            <div className="marketing-actions">
              <Link href="/register" className="btn-filled">{t('landing.createHousehold')} <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
              <Link href="#everyday" className="btn-plain">{t('landing.seeDay')}</Link>
            </div>
            <p className="marketing-note">{t('landing.startSmall')}</p>
          </div>
          <div className="marketing-hero-art">
            <BrandIllustration source={ILLUSTRATIONS.wovenGrove} priority className="woven-grove-art block h-auto w-full" />
          </div>
        </section>

        <section id="everyday" className="marketing-day marketing-width" aria-labelledby="everyday-title">
          <div className="marketing-section-copy">
            <p className="marketing-eyebrow">{t('landing.everydayEyebrow')}</p>
            <h2 id="everyday-title">{t('landing.everydayTitle')}</h2>
            <p>{t('landing.everydayDescription')}</p>
            <dl className="marketing-task-list">
              <div><dt>{t('landing.scheduleTitle')}</dt><dd>{t('landing.scheduleDescription')}</dd></div>
              <div><dt>{t('landing.workTitle')}</dt><dd>{t('landing.workDescription')}</dd></div>
              <div><dt>{t('landing.dinnerTitle')}</dt><dd>{t('landing.dinnerDescription')}</dd></div>
            </dl>
          </div>
          <section className="marketing-preview" aria-label={t('landing.previewLabel')}>
            <p className="marketing-preview-label">{t('landing.previewDisclaimer')}</p>
            <div className="marketing-preview-heading"><h3>{t('landing.previewToday')}</h3><span>{t('landing.previewHousehold')}</span></div>
            <div className="marketing-preview-schedule">
              <h4>{t('landing.previewComingUp')}</h4>
              <p><span className="marketing-preview-time">3:30</span><span>{t('landing.previewLibrary')}<small>{t('landing.previewLibraryNote')}</small></span></p>
              <p><span className="marketing-preview-time">5:00</span><span>{t('landing.previewWalk')}<small>{t('landing.previewWalkNote')}</small></span></p>
            </div>
            <div className="marketing-preview-dinner"><span className="marketing-eyebrow">{t('landing.previewDinner')}</span><p>{t('landing.previewMeal')}</p><small>{t('landing.previewGroceries')}</small></div>
            <div className="marketing-preview-todo"><h4>{t('landing.previewTodo')}</h4><ul><li>{t('landing.previewTaskOne')}</li><li>{t('landing.previewTaskTwo')}</li></ul></div>
          </section>
        </section>

        <section className="marketing-shared marketing-width" aria-labelledby="shared-title">
          <div><p className="marketing-eyebrow">{t('landing.sharedEyebrow')}</p><h2 id="shared-title">{t('landing.sharedTitle')}</h2></div>
          <div><p>{t('landing.sharedDescription')}</p><p className="marketing-note">{t('landing.sharedPrivacy')}</p></div>
        </section>
        <section className="marketing-start marketing-width" aria-labelledby="start-title">
          <div><p className="marketing-eyebrow">{t('landing.startEyebrow')}</p><h2 id="start-title">{t('landing.startTitle')}</h2><p>{t('landing.startDescription')}</p></div>
          <Link href="/register" className="btn-filled">{t('landing.createHousehold')} <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
        </section>

      </main>
      <footer className="marketing-footer marketing-width">
        <span className="brand-wordmark">{PRODUCT_BRAND.wordmark}</span>
        <p>{t('landing.footerDescription')}</p>
        <nav aria-label={t('landing.footerNavigation')}><Link href="/privacy">{t('auth.privacyPolicy')}</Link><Link href="/terms">{t('auth.termsOfService')}</Link><Link href="/login">{t('landing.signIn')}</Link></nav>
      </footer>
    </div>
  )
}
