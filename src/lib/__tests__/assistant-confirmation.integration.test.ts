import type { AssistantConfirmationKind } from "../assistant-reference-contract";
import {
  readDeleteSnapshot,
  issueDeleteTargetProof,
  assistantDeleteTargetGuard,
} from "../assistant-delete-target";
import {
  deletePersonRecord,
  authorizePersonDelete,
  authorizePersonDeleteReplay,
} from "../person-record-delete";
/** Authored/unrun. Opt-in disposable PostgreSQL; no provider or live account. */
import { randomUUID } from "node:crypto";
import { assertFixtureTargetAllowed } from "../fixtures/guard";
import { defaultFeatures } from "../features";
import { createPersonEvent } from "../person-event-create";
import {
  createPersonList,
  createPersonNote,
  authorizeContentCreateReplay,
} from "../person-content-create";
import { loadReferencedAssistantToday } from "../assistant-references";
import {
  issueAssistantSourceProof,
  assistantSourceGuard,
  AssistantSourceRefused,
  authorizeAssistantSourceReplay,
} from "../assistant-source-proof";
import {
  withIdempotency,
  idempotencyRuntime,
  IDEMPOTENCY_MAX_BODY_CHARS,
} from "../idempotency";

const suite = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
jest.setTimeout(60000);
suite("canonical assistant confirmation and lost-response recovery", () => {
  let db: NonNullable<typeof import("../prisma").prisma>;
  const familyId = `confirmation-${randomUUID()}`;
  const userId = `confirmation-${randomUUID()}`;
  const actor = { userId, familyId, role: "parent", generation: 0 };
  const features = {
    ...defaultFeatures(),
    notes: true,
    meals: false,
    inventory: false,
  };
  const observed = new Date("2026-10-22T12:00:00.000Z");
  const gates = [
    "FAMILY_ASSISTANT_CONFIRMATION_READY",
    "FAMILY_ASSISTANT_REFERENCES_READY",
    "ASSISTANT_TODAY_ENABLED",
  ] as const;
  const saved = gates.map((key) => process.env[key]);
  const previousRandom = idempotencyRuntime.random;
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    db = (await import("../prisma")).prisma!;
    await db.family.create({
      data: {
        id: familyId,
        name: "Fabricated confirmation household",
        invite_code: familyId,
        features,
      },
    });
    await db.user.create({
      data: {
        id: userId,
        family_id: familyId,
        role: "parent",
        name: "Synthetic parent",
        email: `${userId}@example.test`,
      },
    });
    for (const key of gates) process.env[key] = "1";
    idempotencyRuntime.random = () => 0.99;
  });
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(observed.getTime() + 10000);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    idempotencyRuntime.random = previousRandom;
    gates.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
    if (!db) return;
    await db.family.deleteMany({ where: { id: familyId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });
  async function guard(kind: AssistantConfirmationKind) {
    const snapshot = await loadReferencedAssistantToday(db, {
      ...actor,
      serverNow: observed,
      localNow: observed,
      viewerTimeZone: "UTC",
      surface: "person",
      materializeSeries: false,
    });
    if (!snapshot) throw new Error("Fixture source missing");
    const proof = issueAssistantSourceProof(
      actor,
      kind,
      snapshot.context,
      snapshot.catalog,
      features,
    );
    return assistantSourceGuard(
      { headers: new Headers({ "X-Assistant-Source-Proof": proof }) },
      actor,
      kind,
    )!;
  }
  it("refuses a changed canonical source before the effect, then replays a committed event after source expiry", async () => {
    const source = await db.event.create({
      data: {
        family_id: familyId,
        created_by: userId,
        title: "Fixture source",
        start_time: observed,
        end_time: new Date(observed.getTime() + 3600000),
        event_type: "other",
      },
    });
    const old = await guard("event_create");
    await db.event.update({
      where: { id: source.id },
      data: { title: "Changed source" },
    });
    const input = {
      title: "Reviewed future event",
      start_time: "2026-11-01T12:00:00.000Z",
      event_type: "other" as const,
    };
    const eventActor = { familyId, userId, name: "Synthetic parent" };
    await expect(
      createPersonEvent(db, input, eventActor, null, old),
    ).rejects.toBeInstanceOf(AssistantSourceRefused);
    expect(
      await db.event.count({
        where: { family_id: familyId, title: input.title },
      }),
    ).toBe(0);
    const current = await guard("event_create");
    const key = randomUUID();
    const run = () =>
      withIdempotency(
        db,
        key,
        { scope: `user:${userId}`, familyId, userId, action: "event.create" },
        input,
        ({ recordId }) =>
          createPersonEvent(db, input, eventActor, recordId, current),
        { beforeReplay: () => authorizeAssistantSourceReplay(db, current) },
      );
    const first = await (await run()).json();
    jest.mocked(Date.now).mockReturnValue(observed.getTime() + 120000);
    const replay = await run();
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(first);
    expect(
      await db.event.count({
        where: { family_id: familyId, title: input.title },
      }),
    ).toBe(1);
  });
  it("keeps exact long note and list receipts, refuses changed keys and renews original authority before replay", async () => {
    const note = {
      title: "Synthetic review note",
      body: "x".repeat(IDEMPOTENCY_MAX_BODY_CHARS + 1),
      color: "blue",
    };
    const noteGuard = await guard("note_create");
    const key = randomUUID();
    const runNote = (body = note) =>
      withIdempotency(
        db,
        key,
        { scope: `user:${userId}`, familyId, userId, action: "note.create" },
        body,
        ({ recordId }) =>
          createPersonNote(db, body, actor, recordId, noteGuard),
        {
          beforeReplay: () => authorizeContentCreateReplay(db, actor, "notes"),
        },
      );
    const first = await (await runNote()).json();
    expect(first.note.body).toHaveLength(note.body.length);
    expect(await (await runNote()).json()).toEqual(first);
    expect((await runNote({ ...note, title: "Changed payload" })).status).toBe(
      422,
    );
    const list = { name: "Synthetic supplies", type: "custom" as const };
    const listGuard = await guard("list_create");
    const listKey = randomUUID();
    const runList = () =>
      withIdempotency(
        db,
        listKey,
        { scope: `user:${userId}`, familyId, userId, action: "list.create" },
        list,
        ({ recordId }) =>
          createPersonList(db, list, actor, recordId, listGuard),
        {
          beforeReplay: () => authorizeContentCreateReplay(db, actor, "lists"),
        },
      );
    const listFirst = await (await runList()).json();
    expect(await (await runList()).json()).toEqual(listFirst);
    expect(
      await db.list.count({ where: { family_id: familyId, name: list.name } }),
    ).toBe(1);
    await db.user.update({ where: { id: userId }, data: { token_version: 1 } });
    try {
      expect((await runNote()).status).toBe(401);
      expect((await runList()).status).toBe(401);
    } finally {
      await db.user.update({
        where: { id: userId },
        data: { token_version: 0 },
      });
    }
  });
  it("refuses changed list contents even when Today is unchanged, then recovers the exact deletion receipt after deletion and expiry", async () => {
    const list = await db.list.create({
      data: {
        family_id: familyId,
        created_by: userId,
        name: "Synthetic deletion review",
        type: "custom",
      },
    });
    const item = await db.listItem.create({
      data: {
        list_id: list.id,
        added_by: userId,
        content: "Original fixture item",
      },
    });
    const source = await guard("list_delete");
    async function targetGuard() {
      const snapshot = await db.$transaction(async (tx) => {
        const denied = await authorizePersonDelete(tx, actor, "list_delete");
        if (denied) throw new Error("Fixture authority missing");
        return readDeleteSnapshot(tx, familyId, "list_delete", list.id);
      });
      if (!snapshot) throw new Error("Fixture target missing");
      const token = issueDeleteTargetProof(
        actor,
        "list_delete",
        list.id,
        snapshot,
      );
      return assistantDeleteTargetGuard(
        { headers: new Headers({ "X-Assistant-Target-Proof": token }) },
        actor,
        "list_delete",
        list.id,
        true,
      )!;
    }
    const old = await targetGuard();
    await db.listItem.update({
      where: { id: item.id },
      data: { content: "Changed after review" },
    });
    await expect(
      deletePersonRecord(db, actor, "list_delete", list.id, null, source, old),
    ).rejects.toBeInstanceOf(AssistantSourceRefused);
    expect(await db.list.count({ where: { id: list.id } })).toBe(1);
    expect(await db.listItem.count({ where: { id: item.id } })).toBe(1);
    const current = await targetGuard();
    const key = randomUUID();
    const run = () =>
      withIdempotency(
        db,
        key,
        { scope: `user:${userId}`, familyId, userId, action: "list.delete" },
        { listId: list.id },
        ({ recordId }) =>
          deletePersonRecord(
            db,
            actor,
            "list_delete",
            list.id,
            recordId,
            source,
            current,
          ),
        {
          beforeReplay: () =>
            authorizePersonDeleteReplay(db, actor, "list_delete"),
        },
      );
    expect(await (await run()).json()).toEqual({ success: true });
    expect(await db.list.count({ where: { id: list.id } })).toBe(0);
    expect(await db.listItem.count({ where: { id: item.id } })).toBe(0);
    jest.mocked(Date.now).mockReturnValue(observed.getTime() + 120000);
    const replay = await run();
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual({ success: true });
    await db.user.update({ where: { id: userId }, data: { token_version: 1 } });
    try {
      expect((await run()).status).toBe(401);
    } finally {
      await db.user.update({
        where: { id: userId },
        data: { token_version: 0 },
      });
    }
  });
  it("does not review or delete another household target through either sourced or ordinary canonical helpers", async () => {
    const foreignFamily = `confirmation-foreign-${randomUUID()}`;
    const foreignUser = `confirmation-foreign-${randomUUID()}`;
    await db.family.create({
      data: {
        id: foreignFamily,
        name: "Synthetic foreign household",
        invite_code: foreignFamily,
      },
    });
    try {
      await db.user.create({
        data: {
          id: foreignUser,
          family_id: foreignFamily,
          role: "parent",
          name: "Synthetic other parent",
          email: `${foreignUser}@example.test`,
        },
      });
      const list = await db.list.create({
        data: {
          family_id: foreignFamily,
          created_by: foreignUser,
          name: "Foreign fixture list",
          type: "custom",
        },
      });
      const snapshot = await db.$transaction((tx) =>
        readDeleteSnapshot(tx, familyId, "list_delete", list.id),
      );
      expect(snapshot).toBeNull();
      const result = await deletePersonRecord(
        db,
        actor,
        "list_delete",
        list.id,
        null,
      );
      expect(result.status).toBe(403);
      expect(await db.list.count({ where: { id: list.id } })).toBe(1);
    } finally {
      await db.family.deleteMany({ where: { id: foreignFamily } });
      await db.user.deleteMany({ where: { id: foreignUser } });
    }
  });
});
