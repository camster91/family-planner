import { NextRequest } from "next/server";
import { GET } from "../route";
import {
  QUEUEABLE_ACTIONS,
  parseStoredQueue,
  serializeQueue,
} from "@/lib/offline-queue";
import {
  capabilityManifestSchema,
  checkMemberProtocol,
  checkQueuedProtocol,
  readApiCapabilities,
} from "@/lib/api-capabilities";

async function manifest() {
  const response = await GET(
    new NextRequest("https://example.test/api/capabilities"),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  return capabilityManifestSchema.parse(await response.json());
}

test("public manifest contains protocol metadata only, no dormant profile support or permissions", async () => {
  const current = await manifest();
  expect(Object.keys(current).sort()).toEqual([
    "contract",
    "memberProtocols",
    "queueActions",
    "queueContainerVersion",
  ]);
  expect(current.memberProtocols).toEqual([1]);
  expect(current.queueActions).toEqual(
    Object.entries(QUEUEABLE_ACTIONS).map(([action, spec]) => ({
      action,
      version: spec.version,
      namespace: spec.namespace,
    })),
  );
  expect(checkMemberProtocol(current, 1)).toEqual({ supported: true });
  expect(checkMemberProtocol(current, 2)).toMatchObject({
    supported: false,
    reason: "MEMBER_PROTOCOL_UNAVAILABLE",
  });
});

test("restores existing version-one queued intents and preserves their keys and minimal payloads", async () => {
  const current = await manifest();
  for (const [action, spec] of Object.entries(QUEUEABLE_ACTIONS)) {
    const payload = action.endsWith("set-checked")
      ? {
          itemId: "fx_item",
          checked: true,
          ...(spec.namespace === "device"
            ? { actingMemberId: "fx_user_a_child" }
            : {}),
        }
      : {
          listId: "fx_list_a_grocery",
          content: "Milk",
          ...(spec.namespace === "device"
            ? { actingMemberId: "fx_user_a_child" }
            : {}),
        };
    const stored = JSON.stringify({
      v: 1,
      ops: [
        {
          id: "pending_original_key_01",
          action,
          v: 1,
          payload,
          createdAt: 1000,
          state: "pending",
          attempts: 2,
          nextAttemptAt: 0,
        },
      ],
    });
    const restored = parseStoredQueue(stored, spec.namespace);
    expect(restored.dropped).toBe(0);
    expect(restored.ops).toHaveLength(1);
    const pending = restored.ops[0];
    expect(JSON.parse(serializeQueue(restored.ops)).ops[0]).toMatchObject({
      id: "pending_original_key_01",
      v: 1,
      payload,
    });
    const before = JSON.stringify(pending);
    expect(checkQueuedProtocol(current, pending, spec.namespace)).toEqual({
      supported: true,
    });
    expect(JSON.stringify(pending)).toBe(before);
    expect(
      checkQueuedProtocol(
        current,
        pending,
        spec.namespace === "person" ? "device" : "person",
      ),
    ).toMatchObject({ supported: false });
    expect(
      checkQueuedProtocol(current, { ...pending, v: 2 }, spec.namespace),
    ).toMatchObject({
      supported: false,
      recovery: "refresh-and-retain-pending",
    });
  }
});

test("synthetic forward/rollback manifests distinguish member protocols and retain recovery intent", async () => {
  const old = await manifest();
  const forward = { ...old, memberProtocols: [1, 2] as (1 | 2)[] };
  expect(checkMemberProtocol(forward, 2)).toEqual({ supported: true });
  expect(checkMemberProtocol(old, 2)).toMatchObject({
    supported: false,
    recovery: "refresh-and-retain-pending",
  });
  expect(checkMemberProtocol(null, 2)).toMatchObject({
    supported: false,
    reason: "SERVER_CHECK_REQUIRED",
  });
});

test.each([404, 500])(
  "old/unavailable server %i is unknown rather than profile write support",
  async (status) => {
    const fetcher = jest.fn().mockResolvedValue(new Response("{}", { status }));
    expect(await readApiCapabilities(fetcher)).toBeNull();
    expect(fetcher).toHaveBeenCalledWith("/api/capabilities", {
      credentials: "same-origin",
      cache: "no-store",
    });
  },
);

test("network failure, malformed JSON and future manifest are recoverable unknown states", async () => {
  expect(
    await readApiCapabilities(
      jest.fn().mockRejectedValue(new Error("offline")),
    ),
  ).toBeNull();
  expect(
    await readApiCapabilities(
      jest.fn().mockResolvedValue(new Response("broken")),
    ),
  ).toBeNull();
  expect(
    await readApiCapabilities(
      jest
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ contract: "herewoven.capabilities.v9" }),
          ),
        ),
    ),
  ).toBeNull();
});
