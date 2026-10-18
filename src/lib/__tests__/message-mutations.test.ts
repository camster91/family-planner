import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  messageAttachmentFilePath,
  messageAttachmentFilename,
  messageAttachmentPath,
  pruneUnboundMessageAttachments,
  storeMessageAttachment,
} from '@/lib/message-attachments'
import { toMessageResponse } from '@/lib/message-mutations'

describe('message response and attachment contracts', () => {
  it('serializes message dates and keeps pickup context free of private pickup fields', () => {
    const response = toMessageResponse({
      id: 'message-1',
      family_id: 'family-1',
      sender: {
        id: 'parent-1',
        family_id: 'family-1',
        name: 'Parent',
        role: 'parent',
      },
      content: 'On my way',
      created_at: new Date('2026-10-18T12:00:00.000Z'),
      pickup: {
        id: 'pickup-1',
        family_id: 'family-1',
        title: 'School',
        pickup_time: new Date('2026-10-18T15:00:00.000Z'),
        completed: false,
        location: 'Private address',
        notes: 'Private instructions',
        assignee: { id: 'child-1', name: 'Child', family_id: 'family-1' },
      },
    })

    expect(response).toMatchObject({
      id: 'message-1',
      created_at: '2026-10-18T12:00:00.000Z',
      pickup: {
        id: 'pickup-1',
        title: 'School',
        pickup_time: '2026-10-18T15:00:00.000Z',
        completed: false,
        assignee: { id: 'child-1', name: 'Child' },
      },
    })
    expect(response.pickup).not.toHaveProperty('location')
    expect(response.pickup).not.toHaveProperty('notes')
    expect(
      toMessageResponse({
        family_id: 'family-1',
        pickup: {
          id: 'pickup-2',
          family_id: 'family-1',
          assignee: { id: 'foreign-child', family_id: 'family-2', name: 'Foreign' },
        },
      }).pickup?.assignee,
    ).toBeNull()
    expect(response.sender).toEqual({
      id: 'parent-1',
      name: 'Parent',
      role: 'parent',
    })
    expect(
      toMessageResponse({
        family_id: 'family-1',
        pickup: { id: 'foreign', family_id: 'family-2' },
      }).pickup,
    ).toBeNull()
    expect(
      toMessageResponse({
        family_id: 'family-1',
        sender: { id: 'foreign', family_id: 'family-2', name: 'Foreign' },
      }).sender,
    ).toBeNull()
  })

  it('uses a private message namespace and rejects unsafe filenames', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const filename = messageAttachmentFilename('family-a', bytes, 'png')
    expect(filename).toMatch(/^[a-f0-9]{32}\.png$/)
    expect(messageAttachmentPath('attachment-1')).toBe(
      '/api/messages/attachments/attachment-1',
    )
    expect(messageAttachmentFilePath(filename, '/tmp/messages-test')).toBe(
      `/tmp/messages-test/messages/${filename}`,
    )
    expect(() =>
      messageAttachmentFilePath('../secret.jpg', '/tmp/messages-test'),
    ).toThrow('Invalid message attachment filename')
  })

  it('prunes only rows still unbound after taking the household lock', async () => {
    const stale = { id: 'attachment-1', filename: `${'a'.repeat(32)}.png` }
    const tx = {
      $queryRaw: jest.fn(),
      messageAttachment: {
        findMany: jest.fn().mockResolvedValue([stale]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const db = {
      $transaction: async (run: (value: typeof tx) => Promise<unknown>) =>
        run(tx),
    }

    await expect(
      pruneUnboundMessageAttachments(db, 'family-1', {
        uploadDir: '/tmp/messages-test',
        now: Date.parse('2026-10-18T00:00:00.000Z'),
      }),
    ).resolves.toBe(1)
    expect(tx.messageAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          family_id: 'family-1',
          message_id: null,
        }),
      }),
    )
    expect(tx.messageAttachment.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'attachment-1' }),
      }),
    )
  })

  it('unlinks a failed upload before a same-name replacement can commit', async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'message-upload-race-'))
    const bytes = new Uint8Array([1, 2, 3, 4])
    const row = {
      id: 'attachment-race',
      family_id: 'family-1',
      uploaded_by: 'user-1',
      message_id: null,
      filename: '',
      content_type: 'image/png' as const,
      size_bytes: bytes.byteLength,
    }
    let transactionCount = 0
    const tx = {
      $queryRaw: jest.fn(),
      family: {
        findUnique: jest.fn().mockResolvedValue({ id: 'family-1' }),
      },
      messageAttachment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          Object.assign(row, data)
          return row
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const db: any = {
      $transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
        transactionCount += 1
        const result = await run(tx)
        if (transactionCount === 2) {
          // This models a new upload acquiring the household lock immediately
          // after cleanup commits and recreating the deterministic filename.
          await writeFile(messageAttachmentFilePath(row.filename, uploadDir), bytes)
        }
        return result
      },
      messageAttachment: {
        findUnique: jest.fn().mockRejectedValue(new Error('verification unavailable')),
      },
    }

    try {
      await expect(
        storeMessageAttachment(
          db,
          'family-1',
          'user-1',
          bytes,
          'image/png',
          'png',
          uploadDir,
        ),
      ).rejects.toThrow('verification unavailable')
      await expect(
        readFile(messageAttachmentFilePath(row.filename, uploadDir)),
      ).resolves.toEqual(Buffer.from(bytes))
    } finally {
      await rm(uploadDir, { recursive: true, force: true })
    }
  })

  it('restores a failed upload when its single cleanup transaction cannot commit', async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'message-upload-commit-'))
    const bytes = new Uint8Array([31, 32, 33, 34])
    const row = {
      id: 'attachment-commit-race',
      family_id: 'family-1',
      uploaded_by: 'user-1',
      message_id: null,
      filename: '',
      content_type: 'image/png' as const,
      size_bytes: bytes.byteLength,
    }
    let transactionCount = 0
    const tx = {
      $queryRaw: jest.fn(),
      family: {
        findUnique: jest.fn().mockResolvedValue({ id: 'family-1' }),
      },
      messageAttachment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => {
          Object.assign(row, data)
          return row
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    const db: any = {
      $transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
        transactionCount += 1
        const result = await run(tx)
        if (transactionCount === 2) throw new Error('cleanup commit failed')
        return result
      },
      messageAttachment: {
        findUnique: jest.fn().mockRejectedValue(new Error('verification unavailable')),
      },
    }

    try {
      await expect(
        storeMessageAttachment(
          db,
          'family-1',
          'user-1',
          bytes,
          'image/png',
          'png',
          uploadDir,
        ),
      ).rejects.toThrow('verification unavailable')
      await expect(
        readFile(messageAttachmentFilePath(row.filename, uploadDir)),
      ).resolves.toEqual(Buffer.from(bytes))
      expect(transactionCount).toBe(3)
    } finally {
      await rm(uploadDir, { recursive: true, force: true })
    }
  })

  it('unlinks stale drafts before a same-name replacement can commit', async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'message-prune-race-'))
    const filename = `${'c'.repeat(32)}.png`
    const replacement = Buffer.from([5, 6, 7, 8])
    const stale = { id: 'attachment-stale-race', filename }
    const tx = {
      $queryRaw: jest.fn(),
      messageAttachment: {
        findMany: jest.fn().mockResolvedValue([stale]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    let transactionCount = 0
    const db: any = {
      $transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
        transactionCount += 1
        const result = await run(tx)
        if (transactionCount === 1) {
          // A new upload can recreate this name only after the cleanup lock
          // is released. The replacement must survive that handoff.
          await writeFile(messageAttachmentFilePath(filename, uploadDir), replacement)
        }
        return result
      },
    }

    try {
      await mkdir(path.join(uploadDir, 'messages'), { recursive: true })
      await writeFile(messageAttachmentFilePath(filename, uploadDir), Buffer.from([9]))
      await expect(
        pruneUnboundMessageAttachments(db, 'family-1', {
          uploadDir,
          now: Date.parse('2026-10-18T00:00:00.000Z'),
        }),
      ).resolves.toBe(1)
      await expect(
        readFile(messageAttachmentFilePath(filename, uploadDir)),
      ).resolves.toEqual(replacement)
    } finally {
      await rm(uploadDir, { recursive: true, force: true })
    }
  })

  it('restores every quarantined draft after a two-candidate rollback without replacing a winner', async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'message-prune-rollback-'))
    const candidates = [
      { id: 'attachment-rollback-a', filename: `${'d'.repeat(32)}.png` },
      { id: 'attachment-rollback-b', filename: `${'e'.repeat(32)}.png` },
    ]
    const originals = [Buffer.from([11, 12]), Buffer.from([13, 14])]
    const replacement = Buffer.from([99, 100])
    const tx = {
      $queryRaw: jest.fn(),
      messageAttachment: {
        findMany: jest.fn().mockResolvedValue(candidates),
        deleteMany: jest.fn().mockImplementation(async () => {
          if (tx.messageAttachment.deleteMany.mock.calls.length === 2)
            throw new Error('second delete failed')
          return { count: 1 }
        }),
      },
    }
    let transactionCount = 0
    const db: any = {
      $transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
        transactionCount += 1
        try {
          return await run(tx)
        } catch (error) {
          if (transactionCount === 1) {
            // A new upload can win the original path after rollback and
            // before compensation reacquires the household lock.
            await writeFile(
              messageAttachmentFilePath(candidates[0].filename, uploadDir),
              replacement,
            )
          }
          throw error
        }
      },
    }

    try {
      await mkdir(path.join(uploadDir, 'messages'), { recursive: true })
      for (let index = 0; index < candidates.length; index += 1) {
        await writeFile(
          messageAttachmentFilePath(candidates[index].filename, uploadDir),
          originals[index],
        )
      }
      await expect(
        pruneUnboundMessageAttachments(db, 'family-1', {
          uploadDir,
          now: Date.parse('2026-10-18T00:00:00.000Z'),
        }),
      ).resolves.toBe(0)
      await expect(
        readFile(messageAttachmentFilePath(candidates[0].filename, uploadDir)),
      ).resolves.toEqual(replacement)
      await expect(
        readFile(messageAttachmentFilePath(candidates[1].filename, uploadDir)),
      ).resolves.toEqual(originals[1])
      expect(transactionCount).toBe(2)
    } finally {
      await rm(uploadDir, { recursive: true, force: true })
    }
  })

  it('restores every quarantined draft when the two-candidate cleanup commit fails', async () => {
    const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'message-prune-commit-'))
    const candidates = [
      { id: 'attachment-commit-a', filename: `${'f'.repeat(32)}.png` },
      { id: 'attachment-commit-b', filename: `${'0'.repeat(32)}.png` },
    ]
    const originals = [Buffer.from([21, 22]), Buffer.from([23, 24])]
    const tx = {
      $queryRaw: jest.fn(),
      messageAttachment: {
        findMany: jest.fn().mockResolvedValue(candidates),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    }
    let transactionCount = 0
    const db: any = {
      $transaction: async (run: (value: typeof tx) => Promise<unknown>) => {
        transactionCount += 1
        const result = await run(tx)
        if (transactionCount === 1) throw new Error('cleanup commit failed')
        return result
      },
    }

    try {
      await mkdir(path.join(uploadDir, 'messages'), { recursive: true })
      for (let index = 0; index < candidates.length; index += 1) {
        await writeFile(
          messageAttachmentFilePath(candidates[index].filename, uploadDir),
          originals[index],
        )
      }
      await expect(
        pruneUnboundMessageAttachments(db, 'family-1', {
          uploadDir,
          now: Date.parse('2026-10-18T00:00:00.000Z'),
        }),
      ).resolves.toBe(0)
      for (let index = 0; index < candidates.length; index += 1) {
        await expect(
          readFile(messageAttachmentFilePath(candidates[index].filename, uploadDir)),
        ).resolves.toEqual(originals[index])
      }
      expect(transactionCount).toBe(2)
    } finally {
      await rm(uploadDir, { recursive: true, force: true })
    }
  })
})
