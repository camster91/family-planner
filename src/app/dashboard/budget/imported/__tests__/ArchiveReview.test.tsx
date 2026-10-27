/** @jest-environment jsdom */
/** Authored/unrun; browser, accessibility and device acceptance are deferred. */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import ArchiveReview from '../ArchiveReview'
import { FINANCE_ARCHIVE_MODELS, FINANCE_ARCHIVE_PROTOCOL, FINANCE_ARCHIVE_DETAIL_PROTOCOL } from '@/lib/finance-archive-contract'
const owner = { userId: 'parent-a', familyId: 'family-a', generation: 3 }
const page = { protocol: FINANCE_ARCHIVE_PROTOCOL, owner, model: null,
  counts: [...FINANCE_ARCHIVE_MODELS, 'other'].map(model => ({ model, count: model === 'bills' ? '1' : '0' })),
  rows: [{ id: 'archive-a', sourceApp: 'Synthetic source', sourceModel: 'bills', sourceId: 'synthetic-record-a', createdAt: '2026-10-25T12:00:00.000Z', sourceLabelsTruncated: false }], nextCursor: 'opaque-next',
}
it('opens metadata in the existing sheet and hides it when the original owner changes', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => page })) as unknown as typeof fetch
  const user = userEvent.setup()
  const { rerender } = render(<ArchiveReview owner={owner} />)
  await screen.findByText('synthetic-record-a', { exact: false })
  await user.click(screen.getByRole('button', { name: /Synthetic source/ }))
  expect(screen.getByRole('dialog', { name: 'Source details' })).toBeTruthy()
  rerender(<ArchiveReview owner={{ ...owner, familyId: 'family-b' }} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText('Synthetic source')).toBeNull()
  await screen.findByText(/This review is unavailable/)
})
it('retries an earlier-page failure with the same cursor and permits returning to newest', async () => {
  let count = 0
  global.fetch = jest.fn(async () => {
    count++
    if (count === 1) return { ok: true, status: 200, json: async () => page }
    return { ok: false, status: 503, json: async () => ({}) }
  }) as unknown as typeof fetch
  const user = userEvent.setup()
  render(<ArchiveReview owner={owner} />)
  await user.click(await screen.findByRole('button', { name: 'Older records' }))
  await user.click(await screen.findByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3))
  const calls = (global.fetch as jest.Mock).mock.calls
  expect(calls[1][0]).toBe('/api/budget/archive?cursor=opaque-next')
  expect(calls[2][0]).toBe(calls[1][0])
  expect(screen.getByRole('button', { name: 'Newest records' })).toBeEnabled()
})

it('shows the stored-copy fingerprint and recorded source version without raw JSON', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => ({ ok: true, status: 200, json: async () => String(input).includes('recordId=') ? {
    protocol: FINANCE_ARCHIVE_DETAIL_PROTOCOL, owner, recordId: 'archive-a',
    fingerprint: { state: 'available', bytes: 2, sha256: 'a'.repeat(64) },
    provenance: { state: 'matched', sourceVersion: 'synthetic-v1', versionTruncated: false },
  } : page })) as unknown as typeof fetch
  const user = userEvent.setup()
  render(<ArchiveReview owner={owner} />)
  await user.click(await screen.findByRole('button', { name: /Synthetic source/ }))
  await screen.findByText('a'.repeat(64))
  expect(screen.getByText('synthetic-v1')).toBeTruthy()
  expect(screen.getByText(/does not verify the original export/)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByText('a'.repeat(64))).toBeNull()
})
it('does not apply detail data returned for a different archive record', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => ({ ok: true, status: 200, json: async () => String(input).includes('recordId=') ? {
    protocol: FINANCE_ARCHIVE_DETAIL_PROTOCOL, owner, recordId: 'archive-b',
    fingerprint: { state: 'available', bytes: 2, sha256: 'b'.repeat(64) },
    provenance: { state: 'matched', sourceVersion: 'wrong-record-version', versionTruncated: false },
  } : page })) as unknown as typeof fetch
  const user = userEvent.setup()
  render(<ArchiveReview owner={owner} />)
  await user.click(await screen.findByRole('button', { name: /Synthetic source/ }))
  await screen.findByText(/Could not load these details/)
  expect(screen.queryByText('wrong-record-version')).toBeNull()
  expect(screen.queryByText('b'.repeat(64))).toBeNull()
})
