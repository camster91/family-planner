'use client'

import { Calendar, CheckCircle, MessageSquare, Users } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from '@/i18n'

export default function Home() {
  const { t } = useTranslation()

  return (
    <div className="container mx-auto px-4 py-12">
      {/* Hero Section */}
      <section className="text-center mb-16">
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
          {t('landing.heroTitle')}
          <span className="block text-4xl md:text-5xl text-blue-600 mt-2">{t('landing.heroSubtitle')}</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
          {t('landing.heroDescription')}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/register"
            className="btn-primary text-lg px-8 py-3 rounded-full"
          >
            {t('landing.startFreeTrial')}
          </Link>
          <Link
            href="/login"
            className="btn-secondary text-lg px-8 py-3 rounded-full"
          >
            {t('landing.signIn')}
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="mb-16">
        <h2 className="text-3xl font-bold text-center mb-12">{t('landing.featuresTitle')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="card text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <CheckCircle className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold mb-3">{t('landing.choreTrackingTitle')}</h3>
            <p className="text-gray-600">
              {t('landing.choreTrackingDesc')}
            </p>
          </div>

          <div className="card text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
              <Calendar className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold mb-3">{t('landing.calendarTitle')}</h3>
            <p className="text-gray-600">
              {t('landing.calendarDesc')}
            </p>
          </div>

          <div className="card text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 rounded-full mb-4">
              <MessageSquare className="w-8 h-8 text-yellow-600" />
            </div>
            <h3 className="text-xl font-semibold mb-3">{t('landing.messagingTitle')}</h3>
            <p className="text-gray-600">
              {t('landing.messagingDesc')}
            </p>
          </div>

          <div className="card text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
              <Users className="w-8 h-8 text-purple-600" />
            </div>
            <h3 className="text-xl font-semibold mb-3">{t('landing.progressTitle')}</h3>
            <p className="text-gray-600">
              {t('landing.progressDesc')}
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-center mb-12">{t('landing.howItWorksTitle')}</h2>
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-8 mb-12">
            <div className="md:w-1/2">
              <div className="text-5xl font-bold text-blue-600 mb-4">1</div>
              <h3 className="text-2xl font-semibold mb-4">{t('landing.step1Title')}</h3>
              <p className="text-gray-600">
                {t('landing.step1Desc')}
              </p>
            </div>
            <div className="md:w-1/2 bg-gray-100 rounded-2xl p-8">
              <div className="aspect-video bg-gradient-to-br from-blue-200 to-indigo-200 rounded-lg flex items-center justify-center">
                <Users className="w-24 h-24 text-blue-600 opacity-50" />
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row-reverse items-center gap-8 mb-12">
            <div className="md:w-1/2">
              <div className="text-5xl font-bold text-green-600 mb-4">2</div>
              <h3 className="text-2xl font-semibold mb-4">{t('landing.step2Title')}</h3>
              <p className="text-gray-600">
                {t('landing.step2Desc')}
              </p>
            </div>
            <div className="md:w-1/2 bg-gray-100 rounded-2xl p-8">
              <div className="aspect-video bg-gradient-to-br from-green-200 to-emerald-200 rounded-lg flex items-center justify-center">
                <CheckCircle className="w-24 h-24 text-green-600 opacity-50" />
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="md:w-1/2">
              <div className="text-5xl font-bold text-purple-600 mb-4">3</div>
              <h3 className="text-2xl font-semibold mb-4">{t('landing.step3Title')}</h3>
              <p className="text-gray-600">
                {t('landing.step3Desc')}
              </p>
            </div>
            <div className="md:w-1/2 bg-gray-100 rounded-2xl p-8">
              <div className="aspect-video bg-gradient-to-br from-purple-200 to-pink-200 rounded-lg flex items-center justify-center">
                <Calendar className="w-24 h-24 text-purple-600 opacity-50" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="text-center bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-12 text-white">
        <h2 className="text-3xl font-bold mb-6">{t('landing.ctaTitle')}</h2>
        <p className="text-xl mb-8 max-w-2xl mx-auto">
          {t('landing.ctaSubtitle')}
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/register"
            className="bg-white text-blue-600 hover:bg-gray-100 text-lg font-semibold px-8 py-3 rounded-full transition"
          >
            {t('landing.ctaPrimary')}
          </Link>
          <a
            href="#features"
            className="bg-transparent border-2 border-white hover:bg-white/10 text-lg font-semibold px-8 py-3 rounded-full transition"
          >
            {t('landing.ctaSecondary')}
          </a>
        </div>
        <p className="mt-6 text-blue-100">
          {t('landing.ctaDisclaimer')}
        </p>
      </section>
    </div>
  )
}