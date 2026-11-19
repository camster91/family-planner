/**
 * @jest-environment jsdom
 */
// The privacy policy and terms are plain-language pages for Herewoven with a
// summary, a table of contents, site navigation and a main landmark. They
// describe the current Cloudflare hosting, not the retired self-hosted setup.
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import PrivacyPage from '../page'
import TermsPage from '../../terms/page'
import JoinLayout from '../../join/layout'

describe.each([
  ['privacy', PrivacyPage, 'Privacy Policy'],
  ['terms', TermsPage, 'Terms of Service'],
] as const)('%s page', (_name, Page, title) => {
  it('has one main landmark, a summary, contents and a way back to the site', () => {
    render(<Page />)
    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(within(main).getByRole('heading', { name: 'The short version' })).toBeTruthy()
    const contents = within(main).getByRole('navigation', { name: 'On this page' })
    const anchors = within(contents).getAllByRole('link')
    expect(anchors.length).toBeGreaterThan(3)
    for (const anchor of anchors) {
      const id = anchor.getAttribute('href')!.slice(1)
      expect(document.getElementById(id)).not.toBeNull()
    }
    const site = screen.getByRole('navigation', { name: 'Site' })
    expect(within(site).getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/')
    expect(document.body.textContent).toContain('Herewoven')
    expect(document.body.textContent).not.toContain('Family Planner')
  })

  it('leaves out retired hosting details and implementation trivia', () => {
    render(<Page />)
    const text = document.body.textContent ?? ''
    for (const stale of ['PostgreSQL', 'self-hosted', 'bcrypt', 'JWT', 'CSRF', '/api/', 'daily backups', 'Backed up daily']) {
      expect(text).not.toContain(stale)
    }
  })
})

describe('privacy page facts', () => {
  it('describes the current hosting and rights as things done in Settings', () => {
    render(<PrivacyPage />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('Cloudflare Workers')
    expect(text).toContain('Cloudflare D1')
    expect(text).toContain('private Cloudflare R2')
    expect(text).toContain('Data Export')
    expect(text).toContain('Delete Account')
    for (const fact of ['Anthropic', 'Open-Meteo', 'Mailgun', '90 days', '12 months', '13 months', 'under 13', 'Limited Use']) {
      expect(text).toContain(fact)
    }
    // Settings links in the app point at this anchor.
    expect(document.getElementById('beta-usage-counts')).not.toBeNull()
  })
})

it('gives /join a main landmark', () => {
  render(
    <JoinLayout>
      <p>Join</p>
    </JoinLayout>,
  )
  expect(within(screen.getByRole('main')).getByText('Join')).toBeTruthy()
})
