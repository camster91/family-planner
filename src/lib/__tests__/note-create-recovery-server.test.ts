/** Source only: no live session, flag activation or storage operation. */
jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
import { noteRecoveryEnabled, noteRecoveryOwner, refuseNoteRecoveryOwner } from "../note-create-recovery-server";
import { NOTE_CREATE_RECOVERY_OWNER_HEADER } from "../note-create-recovery-identity";
import { personQueueOwner } from "../queue-owner-server";
const names = ["QUEUE_OWNER_RECOVERY_ENABLED", "QUEUE_OWNER_RECOVERY_ROLLBACK_READY", "NOTE_CREATE_RECOVERY_ENABLED", "NOTE_CREATE_RECOVERY_ROLLBACK_READY"];
let saved: Array<string | undefined>;
beforeEach(() => { saved = names.map(name => process.env[name]); names.forEach(name => delete process.env[name]); });
afterEach(() => names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; }));
const current = { id: "account-a", family_id: "family-a", role: "child" };
const payload = { userId: current.id, family_id: current.family_id, role: "child", tv: 0, sid: "fixture-session", email: "fixture@example.test" };
const request = (proof?: string) => ({ cookies: { get: () => ({ value: "fabricated-session-cookie" }) }, headers: new Headers(proof ? { [NOTE_CREATE_RECOVERY_OWNER_HEADER]: proof } : {}) }) as never;
it("uses a separate opaque namespace and no permissions without every existing readiness flag", () => {
  const owner = noteRecoveryOwner(request(), payload, current)!;
  expect(owner.scope).not.toBe(personQueueOwner(request(), payload)!.scope);
  expect(owner.scope).toMatch(/^[a-f0-9]{64}$/); expect(owner.generation).toBe(0);
  expect(noteRecoveryEnabled()).toBe(false);
  names.slice(0, 3).forEach(name => { process.env[name] = "1"; }); expect(noteRecoveryEnabled()).toBe(false);
  process.env[names[3]] = "1"; expect(noteRecoveryEnabled()).toBe(true);
});
it("keeps legacy no-header calls compatible and enforces supplied proofs while paused", () => {
  const owner = noteRecoveryOwner(request(), payload, current)!;
  expect(refuseNoteRecoveryOwner(request(), payload, current, true)).toBeNull();
  expect(refuseNoteRecoveryOwner(request(owner.scope), payload, current)).toBeNull();
  expect(refuseNoteRecoveryOwner(request(owner.scope), payload, current, true)?.status).toBe(409);
  expect(refuseNoteRecoveryOwner(request("wrong"), payload, current)?.status).toBe(409);
  expect(noteRecoveryOwner(request(), payload, { ...current, family_id: "family-b" })?.scope).not.toBe(owner.scope);
});
