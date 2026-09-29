/**
 * @jest-environment jsdom
 */
// Route inventory F-5 (#289): the project page offers "Add task" (the caller
// of POST /api/projects/[id]/tasks) on an active project only.
import * as React from 'react'
import { render, screen } from '@testing-library/react'

const mockPrisma = {
  user: { findUnique: jest.fn(), findMany: jest.fn() },
  project: { findUnique: jest.fn() },
}
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))
jest.mock('@/lib/supabase/server', () => ({
  getServerUser: async () => ({ id: 'u1', email: 'teen@example.test', role: 'teen', family_id: 'fam-a' }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

import ProjectDetailPage from '../[id]/page'
import { ToastProvider } from '@/components/ui/toast'
import { defaultFeatures } from '@/lib/features'

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

function project(status: string, familyId = 'fam-a') {
  return {
    id: 'p1',
    family_id: familyId,
    name: 'Garage',
    description: null,
    color: '#000',
    status,
    creator: { id: 'u1', name: 'Pat', avatar_url: null },
    tasks: [],
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockPrisma.user.findUnique.mockResolvedValue({
    family_id: 'fam-a',
    role: 'teen',
    family: { features: { ...defaultFeatures(), projects: true } },
  })
  mockPrisma.user.findMany.mockResolvedValue([
    { id: 'u1', name: 'Pat' },
    { id: 'u2', name: 'Sam' },
  ])
})

it('an active project shows "Add task"', async () => {
  mockPrisma.project.findUnique.mockResolvedValue(project('active'))
  render(<ToastProvider>{await renderDetail('p1')}</ToastProvider>)
  expect(screen.getByRole('button', { name: 'Add task' })).toBeTruthy()
})

it.each(['completed', 'archived'])('a %s project has no "Add task" (the API refuses it)', async (status) => {
  mockPrisma.project.findUnique.mockResolvedValue(project(status))
  render(<ToastProvider>{await renderDetail('p1')}</ToastProvider>)
  expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
})

it("another household's project is not found", async () => {
  mockPrisma.project.findUnique.mockResolvedValue(project('active', 'fam-b'))
  await expect(renderDetail('p1')).rejects.toThrow('NEXT_NOT_FOUND')
})
