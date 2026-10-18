/**
 * Real PostgreSQL coverage for private message sends.
 *
 * Opt in only with RUN_DB_INTEGRATION=1, FIXTURES_ALLOW=1 and a disposable
 * DATABASE_URL. The suite exercises the same idempotency/domain transaction
 * used by POST /api/messages, without opening a server or external transport.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";

export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" &&
  process.env.FIXTURES_ALLOW === "1" &&
  process.env.NODE_ENV !== "production"
    ? describe
    : describe.skip;

jest.setTimeout(120_000);

type Db = NonNullable<typeof import("@/lib/prisma").prisma>;
type EffectResult = import("@/lib/idempotency").EffectResult;
type MessageActor = import("@/lib/message-mutations").MessageActor;
type MessageWriteBody = import("@/lib/message-mutations").MessageWriteBody;

const PREFIX = `messages-int-${process.pid}-${crypto.randomUUID()}`;
const FAMILY_A = `${PREFIX}-family-a`;
const FAMILY_B = `${PREFIX}-family-b`;
const PARENT_A = `${PREFIX}-parent-a`;
const CHILD_A = `${PREFIX}-child-a`;
const PARENT_B = `${PREFIX}-parent-b`;
const PICKUP_A = `${PREFIX}-pickup-a`;
const PICKUP_B = `${PREFIX}-pickup-b`;

const actorA: MessageActor = { id: PARENT_A, familyId: FAMILY_A };
const actorChildA: MessageActor = { id: CHILD_A, familyId: FAMILY_A };
const actorB: MessageActor = { id: PARENT_B, familyId: FAMILY_B };

const body = (overrides: Partial<MessageWriteBody> = {}): MessageWriteBody => ({
  content: "Leaving now",
  type: "text",
  attachment_ids: [],
  ...overrides,
});

const context = {
  scope: `user:${PARENT_A}`,
  familyId: FAMILY_A,
  userId: PARENT_A,
  action: "message.create",
};

describeWithDatabase("message mutations against disposable PostgreSQL", () => {
  let db: Db;
  let idem: typeof import("@/lib/idempotency");
  let createMessageEffect: typeof import("@/lib/message-mutations").createMessageEffect;
  let authorizeMessageActorInTx: typeof import("@/lib/message-mutations").authorizeMessageActorInTx;
  let storeMessageAttachment: typeof import("@/lib/message-attachments").storeMessageAttachment;
  let uploadDir: string;

  async function cleanup(): Promise<void> {
    if (!db) return;
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY_A, FAMILY_B] } },
    });
    await db.messageAttachment.deleteMany({
      where: { family_id: { in: [FAMILY_A, FAMILY_B] } },
    });
    await db.message.deleteMany({
      where: { family_id: { in: [FAMILY_A, FAMILY_B] } },
    });
    await db.pickup.deleteMany({
      where: { family_id: { in: [FAMILY_A, FAMILY_B] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [PARENT_A, CHILD_A, PARENT_B] } },
    });
    await db.family.deleteMany({
      where: { id: { in: [FAMILY_A, FAMILY_B] } },
    });
  }

  async function seed(): Promise<void> {
    await db.family.createMany({
      data: [
        {
          id: FAMILY_A,
          name: "Message integration A",
          invite_code: `${PREFIX}-invite-a`,
          features: { messages: true },
        },
        {
          id: FAMILY_B,
          name: "Message integration B",
          invite_code: `${PREFIX}-invite-b`,
          features: { messages: false },
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT_A,
          email: `${PREFIX}-parent-a@example.test`,
          name: "Parent A",
          role: "parent",
          family_id: FAMILY_A,
        },
        {
          id: CHILD_A,
          email: `${PREFIX}-child-a@example.test`,
          name: "Child A",
          role: "child",
          family_id: FAMILY_A,
        },
        {
          id: PARENT_B,
          email: `${PREFIX}-parent-b@example.test`,
          name: "Parent B",
          role: "parent",
          family_id: FAMILY_B,
        },
      ],
    });
    await db.pickup.createMany({
      data: [
        {
          id: PICKUP_A,
          family_id: FAMILY_A,
          title: "Family A pickup",
          pickup_time: new Date("2026-10-18T15:00:00.000Z"),
          created_by: PARENT_A,
        },
        {
          id: PICKUP_B,
          family_id: FAMILY_B,
          title: "Family B pickup",
          pickup_time: new Date("2026-10-18T16:00:00.000Z"),
          created_by: PARENT_B,
        },
      ],
    });
  }

  async function send(
    actor: MessageActor,
    messageBody: MessageWriteBody,
    key: string | null,
  ) {
    return idem.withIdempotency(
      db,
      key,
      {
        scope: `user:${actor.id}`,
        familyId: actor.familyId,
        userId: actor.id,
        action: "message.create",
      },
      messageBody,
      ({ recordId }) => createMessageEffect(db, actor, messageBody, recordId),
      {
        beforeReplay: () =>
          db.$transaction(async (tx) => authorizeMessageActorInTx(tx, actor)),
      },
    );
  }

  beforeAll(async () => {
    // Guard before loading Prisma, so a malformed or production-like URL never
    // opens a client in this suite.
    assertFixtureTargetAllowed(process.env);
    const loaded = await import("@/lib/prisma");
    if (!loaded.prisma) throw new Error("Message integration needs Prisma");
    db = loaded.prisma;
    idem = await import("@/lib/idempotency");
    createMessageEffect = (await import("@/lib/message-mutations"))
      .createMessageEffect;
    authorizeMessageActorInTx = (await import("@/lib/message-mutations"))
      .authorizeMessageActorInTx;
    storeMessageAttachment = (await import("@/lib/message-attachments"))
      .storeMessageAttachment;
    idem.idempotencyRuntime.random = () => 0.99;
    uploadDir = await mkdtemp(path.join(tmpdir(), "messages-int-"));
  });

  beforeEach(async () => {
    await cleanup();
    await seed();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
      await db?.$disconnect();
    }
  });

  it("converges concurrent same-key sends to one message and one receipt", async () => {
    const requestKey = `${PREFIX}-concurrent`;
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => send(actorA, body(), requestKey)),
    );

    expect(responses.some((response) => response.status === 200)).toBe(true);
    expect(
      responses.every((response) => [200, 409].includes(response.status)),
    ).toBe(true);
    const successful = responses.filter((response) => response.status === 200);
    const ids = new Set(
      await Promise.all(
        successful.map(async (response) => (await response.json()).message.id),
      ),
    );
    expect(ids.size).toBe(1);
    expect(await db.message.count({ where: { family_id: FAMILY_A } })).toBe(1);
    expect(
      await db.idempotencyRecord.count({
        where: { family_id: FAMILY_A, key: requestKey, response_status: 200 },
      }),
    ).toBe(1);
  });

  it("replays only while the actor still belongs to an enabled household", async () => {
    const requestKey = `${PREFIX}-authority`;
    const first = await send(actorA, body({ content: "once" }), requestKey);
    expect(first.status).toBe(200);

    await db.user.update({
      where: { id: PARENT_A },
      data: { family_id: null },
    });
    const downgraded = await send(
      actorA,
      body({ content: "once" }),
      requestKey,
    );
    expect(downgraded.status).toBe(404);
    expect(downgraded.headers.get("Idempotency-Replayed")).toBeNull();
    expect(await db.message.count({ where: { family_id: FAMILY_A } })).toBe(1);

    await db.user.update({
      where: { id: PARENT_A },
      data: { family_id: FAMILY_A },
    });
    await db.family.update({
      where: { id: FAMILY_A },
      data: { features: { messages: false } },
    });
    const disabled = await send(actorA, body({ content: "once" }), requestKey);
    expect(disabled.status).toBe(403);
    expect(await db.message.count({ where: { family_id: FAMILY_A } })).toBe(1);
  });

  it("rejects foreign pickup and feature-off sends without writing", async () => {
    const foreignPickup = await send(
      actorA,
      body({ pickup_id: PICKUP_B }),
      null,
    );
    expect(foreignPickup.status).toBe(404);

    const disabledFamily = await send(actorB, body(), null);
    expect(disabledFamily.status).toBe(403);
    expect(await db.message.count({ where: { family_id: FAMILY_A } })).toBe(0);
    expect(await db.message.count({ where: { family_id: FAMILY_B } })).toBe(0);
  });

  it("claims only same-family attachments and keeps reads household-scoped", async () => {
    const attachment = await storeMessageAttachment(
      db,
      FAMILY_A,
      PARENT_A,
      new Uint8Array([1, 2, 3, 4]),
      "image/png",
      "png",
      uploadDir,
    );
    const foreignAttempt = await send(
      actorB,
      body({ attachment_ids: [attachment.id] }),
      null,
    );
    expect(foreignAttempt.status).toBe(403);

    await db.family.update({
      where: { id: FAMILY_B },
      data: { features: { messages: true } },
    });
    const wrongHouseholdAttachment = await send(
      actorB,
      body({ attachment_ids: [attachment.id] }),
      null,
    );
    expect(wrongHouseholdAttachment.status).toBe(404);

    const committed = await send(
      actorA,
      body({ attachment_ids: [attachment.id], pickup_id: PICKUP_A }),
      null,
    );
    expect(committed.status).toBe(200);
    const committedBody = await committed.json();
    expect(committedBody.message.attachments).toEqual([
      `/api/messages/attachments/${attachment.id}`,
    ]);
    expect(
      await db.messageAttachment.findUnique({ where: { id: attachment.id } }),
    ).toMatchObject({
      family_id: FAMILY_A,
      message_id: committedBody.message.id,
    });
    expect(
      await db.message.findMany({ where: { family_id: FAMILY_B } }),
    ).toHaveLength(0);
    expect(
      await db.message.findMany({ where: { family_id: FAMILY_A } }),
    ).toHaveLength(1);
  });

  it("keeps identical uploads owned and allocates fresh rows after a claim", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const parentDraft = await storeMessageAttachment(
      db,
      FAMILY_A,
      PARENT_A,
      bytes,
      "image/png",
      "png",
      uploadDir,
    );
    const sameUploaderDraft = await storeMessageAttachment(
      db,
      FAMILY_A,
      PARENT_A,
      bytes,
      "image/png",
      "png",
      uploadDir,
    );
    expect(sameUploaderDraft.id).toBe(parentDraft.id);

    const childDraft = await storeMessageAttachment(
      db,
      FAMILY_A,
      CHILD_A,
      bytes,
      "image/png",
      "png",
      uploadDir,
    );
    expect(childDraft.id).not.toBe(parentDraft.id);
    expect(childDraft.filename).not.toBe(parentDraft.filename);

    const childCannotClaimParentDraft = await send(
      actorChildA,
      body({ content: "Child cannot claim parent draft", attachment_ids: [parentDraft.id] }),
      null,
    );
    expect(childCannotClaimParentDraft.status).toBe(404);

    const parentCommitted = await send(
      actorA,
      body({ content: "Parent sends the photo", attachment_ids: [parentDraft.id] }),
      null,
    );
    expect(parentCommitted.status).toBe(200);

    const parentReuploadAfterClaim = await storeMessageAttachment(
      db,
      FAMILY_A,
      PARENT_A,
      bytes,
      "image/png",
      "png",
      uploadDir,
    );
    expect(parentReuploadAfterClaim.id).not.toBe(parentDraft.id);
    expect(parentReuploadAfterClaim.filename).not.toBe(parentDraft.filename);

    const childCommitted = await send(
      actorChildA,
      body({ content: "Child sends the photo", attachment_ids: [childDraft.id] }),
      null,
    );
    expect(childCommitted.status).toBe(200);
    expect(
      await db.messageAttachment.findUnique({ where: { id: parentReuploadAfterClaim.id } }),
    ).toMatchObject({ family_id: FAMILY_A, uploaded_by: PARENT_A, message_id: null });
    expect(await db.message.count({ where: { family_id: FAMILY_A } })).toBe(2);
  });
});
