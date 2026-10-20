import { NextRequest } from "next/server";
import {
  inventoryRecoveryEnabled,
  inventoryRecoveryOwner,
  refuseInventoryRecoveryOwner,
} from "../inventory-recovery-server";
import { personQueueOwner } from "../queue-owner-server";
import { INVENTORY_RECOVERY_OWNER_HEADER } from "../inventory-recovery-contract";
import type { TokenPayload } from "../auth";
const actor = {
  id: "fixture-parent",
  family_id: "fixture-family",
  role: "parent",
};
const payload: TokenPayload = {
  userId: actor.id,
  email: "fixture@example.test",
  family_id: "stale-family",
  role: "child",
  sid: "fixture_session_nonce",
  tv: 0,
};
function request(proof?: string, cookie = "fixture-cookie") {
  return new NextRequest("https://example.test/api/inventory/intake", {
    headers: {
      cookie: `session_token=${cookie}`,
      ...(proof ? { [INVENTORY_RECOVERY_OWNER_HEADER]: proof } : {}),
    },
  });
}
const flags = [
  "INVENTORY_RECOVERY_ENABLED",
  "INVENTORY_RECOVERY_ROLLBACK_READY",
  "QUEUE_OWNER_RECOVERY_ENABLED",
  "QUEUE_OWNER_RECOVERY_ROLLBACK_READY",
];
const savedFlags = flags.map((key) => process.env[key]);
beforeEach(() => {
  flags.forEach((key) => delete process.env[key]);
});
afterEach(() => {
  flags.forEach((key, index) => {
    if (savedFlags[index] === undefined) delete process.env[key];
    else process.env[key] = savedFlags[index];
  });
});
it("derives a separate storage scope from current canonical household/role, never stale JWT claims", () => {
  const owner = inventoryRecoveryOwner(request(), payload, actor)!;
  const currentPayload = {
    ...payload,
    family_id: actor.family_id,
    role: actor.role,
  };
  const grocery = personQueueOwner(request(), currentPayload)!;
  expect(owner.scope).not.toBe(grocery.scope);
  expect(owner.householdScope).toBe(grocery.householdScope);
  expect(owner.ownerId).toBe(actor.id);
  expect(owner.generation).toBe(grocery.generation);
  expect(inventoryRecoveryOwner(request(), currentPayload, actor)).toEqual(
    owner,
  );
  expect(
    inventoryRecoveryOwner(request(), payload, {
      ...actor,
      family_id: "other-family",
    })!.scope,
  ).not.toBe(owner.scope);
  expect(
    inventoryRecoveryOwner(request(), payload, { ...actor, role: "teen" })!
      .scope,
  ).not.toBe(owner.scope);
});
it("requires a modern signed-in session and changes scope on session/canonical context replacement", () => {
  expect(
    inventoryRecoveryOwner(request(), { ...payload, sid: undefined }, actor),
  ).toBeNull();
  expect(
    inventoryRecoveryOwner(request(), payload, {
      ...actor,
      id: "other-parent",
    }),
  ).toBeNull();
  expect(
    inventoryRecoveryOwner(
      request(undefined, "replacement-cookie"),
      payload,
      actor,
    )!.scope,
  ).not.toBe(inventoryRecoveryOwner(request(), payload, actor)!.scope);
});
it("keeps legacy writes compatible and enforces supplied proof even with all recovery flags off", () => {
  expect(inventoryRecoveryEnabled()).toBe(false);
  expect(refuseInventoryRecoveryOwner(request(), payload, actor)).toBeNull();
  const scope = inventoryRecoveryOwner(request(), payload, actor)!.scope;
  expect(
    refuseInventoryRecoveryOwner(request(scope), payload, actor),
  ).toBeNull();
  const denied = refuseInventoryRecoveryOwner(
    request("other-owner"),
    payload,
    actor,
  )!;
  expect(denied.status).toBe(409);
  expect(denied.headers.get("Cache-Control")).toBe("private, no-store");
});
it("needs both inventory gates plus both adopted owner-retirement gates before negotiating writes", () => {
  process.env.INVENTORY_RECOVERY_ENABLED = "1";
  process.env.INVENTORY_RECOVERY_ROLLBACK_READY = "1";
  expect(inventoryRecoveryEnabled()).toBe(false);
  process.env.QUEUE_OWNER_RECOVERY_ENABLED = "1";
  expect(inventoryRecoveryEnabled()).toBe(false);
  process.env.QUEUE_OWNER_RECOVERY_ROLLBACK_READY = "1";
  expect(inventoryRecoveryEnabled()).toBe(true);
});
