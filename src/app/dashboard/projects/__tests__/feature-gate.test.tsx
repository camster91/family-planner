/**
 * @jest-environment jsdom
 */
// Projects page (route inventory F-2): with the `projects` feature off the
// server page renders the calm "is off" state and reads no project.
import * as React from 'react'
import { render, screen } from '@testing-library/react'

const mockPrisma = {
  user: { findUnique: jest.fn() },
  project: { findMany: jest.fn(), findUnique: jest.fn() },
}
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
jest.mock('@/lib/supabase/server', () => ({
  getServerUser: async () => ({ id: 'u1', email: 'parent@example.test', role: 'parent', family_id: 'fam-a' }),
}))

import ProjectsPage from '../page'
import ProjectDetailPage from '../[id]/page'
import CreateProjectPage from '../create/page'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { FeatureOffState } from '@/components/ui/feature-gate'
import { defaultFeatures } from '@/lib/features'

function familyWith(projects: boolean) {
  mockPrisma.user.findUnique.mockResolvedValue({
    family_id: 'fam-a',
    family: { features: { ...defaultFeatures(), projects } },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPrisma.project.findMany.mockResolvedValue([])
})

it('shows the off state and reads no projects when Projects is off', async () => {
  familyWith(false)
  const page = await ProjectsPage()
  expect(page?.type).toBe(FeatureOffState)
  render(page!)
  expect(screen.getByRole('heading', { name: 'Projects is off' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'New' })).toBeNull()
  expect(mockPrisma.project.findMany).not.toHaveBeenCalled()
})

it('renders the projects page when Projects is on', async () => {
  familyWith(true)
  const page = await ProjectsPage()
  expect(page).not.toBeNull()
  expect(page?.type).not.toBe(FeatureOffState)
})

// The detail page streams through Suspense; unwrap its async children the way
// the server renderer would, without a real RSC runtime.
type AnyProps = Record<string, unknown>
type AsyncComponent = (props: AnyProps) => Promise<React.ReactElement<AnyProps> | null>

async function renderDetail(id: string) {
  const outer = ProjectDetailPage({ params: Promise.resolve({ id }) }) as React.ReactElement<{
    children: React.ReactElement<AnyProps>
  }>
  const asyncChild = outer.props.children
  const inner = await (asyncChild.type as AsyncComponent)(asyncChild.props)
  if (!inner) return null
  return (inner.type as AsyncComponent)(inner.props)
}

it('the create page shows the off state instead of the form when Projects is off', () => {
  render(
    <FeaturesProvider initial={{ ...defaultFeatures(), projects: false }}>
      <CreateProjectPage />
    </FeaturesProvider>
  )
  expect(screen.getByRole('heading', { name: 'Projects is off' })).toBeTruthy()
  expect(screen.queryByRole('textbox')).toBeNull()
})

it('the project detail page shows the off state and reads no project when Projects is off', async () => {
  familyWith(false)
  const page = await renderDetail('p1')
  expect(page?.type).toBe(FeatureOffState)
  expect(mockPrisma.project.findUnique).not.toHaveBeenCalled()
})
