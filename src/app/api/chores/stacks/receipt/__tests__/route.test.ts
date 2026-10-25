// Route source cases authored UNRUN; no API/database requests executed.
jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock);
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock);
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock);
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }));
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: jest.fn(async () => null) }));
jest.mock('@/lib/routine-stack-api', () => ({ inspectParentRoutineStack: jest.fn(async () => ({ status: 200, body: { state: 'unknown' } })) }));
import { POST } from '../route';
import { inspectParentRoutineStack } from '@/lib/routine-stack-api';
import { db, req } from '@/__tests__/helpers/two-household';
beforeEach(() => { db.reset(); jest.clearAllMocks(); });
it.each([null, 'childA', 'teenA'] as const)('refuses receipt inspection by %s before the reader', async as => {
  const response = await POST(req({ as, method: 'POST', headers: { 'Idempotency-Key': 'original-receipt-key-0001' }, body: {} }));
  expect(response.status).toBe(as ? 403 : 401);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(inspectParentRoutineStack).not.toHaveBeenCalled();
});
it('passes only server-authenticated scope and original key/body to the reader', async () => {
  const body = { fixture: 'original' };
  const response = await POST(req({ as: 'parentA', method: 'POST', headers: { 'Idempotency-Key': 'original-receipt-key-0001' }, body }));
  expect(response.status).toBe(200);
  expect(inspectParentRoutineStack).toHaveBeenCalledWith(expect.anything(), body, expect.objectContaining({ userId: 'parent-a', familyId: 'family-A', role: 'parent', tokenVersion: 0 }), 'original-receipt-key-0001');
  expect(db.writes).toHaveLength(0);
});
it('bounds declared payloads before reading or entering the receipt helper', async () => {
  const input = req({ as: 'parentA', method: 'POST', headers: { 'Idempotency-Key': 'original-receipt-key-0001', 'content-length': String(2 * 1024 * 1024 + 1) }, body: {} });
  input.json = jest.fn();
  expect((await POST(input)).status).toBe(413);
  expect(input.json).not.toHaveBeenCalled();
  expect(inspectParentRoutineStack).not.toHaveBeenCalled();
});
