jest.mock('@/lib/household-lock', () => ({ lockUser: jest.fn(async () => undefined), lockHousehold: jest.fn(async () => undefined) }))
import { authorizeMessageActorInTx } from '../message-authority'
/** Source cases only; no test execution in this checkpoint. */
import { parseMessageWriteContext, messageOwnerHeaderMatches, messageExpectedOwnerMatches, messageSendWindowOpen, MESSAGE_SEND_RETRY_MS, MESSAGE_SEND_FUTURE_SKEW_MS } from '../message-owner-contract'
import { sendMessageSchema } from '../validations'
const owner = { protocol: 'herewoven.message-owner.v1', userId: 'person-a', familyId: 'family-a', generation: 3 }
it('refuses foreign/malformed/future upload context without treating it as authority', () => {
  const actor = { userId: 'person-a', familyId: 'family-a', generation: 3 }
  expect(parseMessageWriteContext(owner)).toEqual(owner)
  expect(messageOwnerHeaderMatches(JSON.stringify(owner), actor)).toBe(true)
  for (const value of [{ ...owner, familyId: 'family-b' }, { ...owner, userId: 'person-b' }, { ...owner, generation: 2 }, { ...owner, protocol: 'future' }, { ...owner, token: 'fabricated-extra-field' }])
    expect(messageOwnerHeaderMatches(JSON.stringify(value), actor)).toBe(false)
  expect(messageOwnerHeaderMatches('{', actor)).toBe(false)
  expect(messageOwnerHeaderMatches('x'.repeat(1025), actor)).toBe(false)
  expect(messageOwnerHeaderMatches(null, actor)).toBe(true) // legacy endpoint only
})
it('requires the whole message precondition and preserves legacy bodies', () => {
  expect(sendMessageSchema.safeParse({ content: 'Hello' }).success).toBe(true)
  expect(sendMessageSchema.safeParse({ content: 'Hello', expected_user_id: 'person-a' }).success).toBe(false)
  const body = { content: 'Hello', expected_user_id: 'person-a', expected_family_id: 'family-a', expected_generation: 3 }
  expect(sendMessageSchema.safeParse(body).success).toBe(true)
  expect(messageExpectedOwnerMatches(body, owner)).toBe(true)
  expect(messageExpectedOwnerMatches(body, { ...owner, generation: 4 })).toBe(false)
})

it('renews session generation under locks before reading feature data or permitting effects', async () => {
  const tx = { user: { findUnique: jest.fn(async () => ({ family_id: 'family-a', token_version: 4 })) }, family: { findUnique: jest.fn() } }
  expect(await authorizeMessageActorInTx(tx, { id: 'person-a', familyId: 'family-a', generation: 3 })).toMatchObject({ status: 401 })
  expect(tx.family.findUnique).not.toHaveBeenCalled()
})

it('holds expired, malformed and clock-invalid original sends before receipt retention can expire', () => {
  const now = Date.parse('2026-10-25T12:00:00.000Z')
  const at = (offset: number) => new Date(now + offset).toISOString()
  expect(messageSendWindowOpen(at(0), now)).toBe(true)
  expect(messageSendWindowOpen(at(-MESSAGE_SEND_RETRY_MS + 1), now)).toBe(true)
  expect(messageSendWindowOpen(at(-MESSAGE_SEND_RETRY_MS), now)).toBe(false)
  expect(messageSendWindowOpen(at(MESSAGE_SEND_FUTURE_SKEW_MS), now)).toBe(true)
  expect(messageSendWindowOpen(at(MESSAGE_SEND_FUTURE_SKEW_MS + 1), now)).toBe(false)
  expect(messageSendWindowOpen('not-a-date', now)).toBe(false)
  expect(messageSendWindowOpen(at(0), NaN)).toBe(false)
})
