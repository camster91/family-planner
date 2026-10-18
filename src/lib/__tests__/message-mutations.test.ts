import {
  messageAttachmentFilePath,
  messageAttachmentFilename,
  messageAttachmentPath,
  pruneUnboundMessageAttachments,
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
        assignee: { id: 'child-1', name: 'Child' },
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
        where: expect.objectContaining({ id: { in: ['attachment-1'] } }),
      }),
    )
  })
})
