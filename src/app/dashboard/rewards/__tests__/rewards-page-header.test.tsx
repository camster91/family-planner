/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '@/i18n'
import { RewardsNoFamilyState, RewardsPageHeader } from '@/components/rewards/RewardsPageHeader'

describe('RewardsPageHeader', () => {
  it.each([
    ['en', 'Rewards', 'Use the points you earn to claim rewards'],
    ['es', 'Recompensas', 'Usa los puntos que ganas para reclamar recompensas'],
  ] as const)('uses typed %s page copy while preserving the household name', (locale, title, fallbackSubtitle) => {
    render(
      <I18nProvider locale={locale}>
        <RewardsPageHeader familyName="Casa Rivera" />
      </I18nProvider>,
    )

    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getByText('Casa Rivera')).toBeTruthy()
    expect(screen.queryByText(fallbackSubtitle)).toBeNull()
    expect(screen.queryByText(/ family$/i)).toBeNull()
  })

  it.each([
    ['en', 'Rewards', 'No family set up', 'Create or join a family to start earning and claiming rewards.'],
    ['es', 'Recompensas', 'Aún no hay una familia', 'Crea una familia o únete a una para empezar a ganar y reclamar recompensas.'],
  ] as const)('localizes the %s no-family state', (locale, title, noFamilyTitle, description) => {
    render(
      <I18nProvider locale={locale}>
        <RewardsPageHeader />
        <RewardsNoFamilyState />
      </I18nProvider>,
    )

    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(screen.getByRole('heading', { name: noFamilyTitle })).toBeTruthy()
    expect(screen.getByText(description)).toBeTruthy()
  })
})
