/**
 * @jest-environment jsdom
 */
// A feature that is off tells a parent where to turn it on. A teen or child
// cannot open Features, so they are told to ask a parent and get no button.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { FeatureGate, FeatureOffState } from '../feature-gate'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures } from '@/lib/features'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}))

describe('FeatureOffState', () => {
  it('gives a parent the Open Features link', () => {
    render(<FeatureOffState featureKey="budget" />)
    expect(screen.getByRole('link', { name: /Open Features/ }).getAttribute('href')).toBe('/dashboard/features')
    expect(screen.getByText(/You can turn it on in Features settings/)).toBeTruthy()
  })

  it('tells a child to ask a parent, with no button', () => {
    render(<FeatureOffState featureKey="budget" canManage={false} />)
    expect(screen.queryByRole('link', { name: /Open Features/ })).toBeNull()
    expect(screen.getByText(/Ask a parent to turn it on/)).toBeTruthy()
  })

  it('FeatureGate reads the role from the features provider', () => {
    const off = { ...defaultFeatures(), budget: false }
    render(
      <FeaturesProvider initial={off} canManage={false}>
        <FeatureGate featureKey="budget">
          <p>budget page</p>
        </FeatureGate>
      </FeaturesProvider>
    )
    expect(screen.queryByText('budget page')).toBeNull()
    expect(screen.queryByRole('link', { name: /Open Features/ })).toBeNull()
  })
})
