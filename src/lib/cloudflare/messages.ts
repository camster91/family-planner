/** Native D1 adapter for the ordinary family chat API.
 *
 * The PostgreSQL handlers remain the source of the HTTP contract. This module
 * mirrors that contract with household-scoped read plans and atomic SQL
 * effects so a Worker never opens the write Prisma client. In particular,
 * receipts are checked only after current actor authority and feature state
 * have been read, and attachment claims are constrained by family, uploader,
 * and the unclaimed state.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import {
  messageExpectedOwnerMatches,
  messageSendWindowOpen,
  messageSendWindowRefusal,
  type MessageWriteContext,
} from "@/lib/message-owner-contract";
import { afterMessageCursor, encodeMessageCursor, type MessagePaging } from "@/lib/message-paging";
import type { MessageWriteBody } from "@/lib/message-mutations";
import { executeD1PersonEffect, type NativePersonPlan } from "./person-effect";
import { captureD1Reads } from "./read-witness";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";
import { getD1Database, type D1Statement, type D1Store } from "./database";
import { type D1ReadClient, type NativeD1 } from "./read-client";

const MESSAGE_ATTACHMENT_PREFIX = "/api/messages/attachments/";
const MESSAGE_ACTION = "message.create";

export type D1MessageActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

export type D1MessageReadOptions = {
  modern: boolean;
  limit: number;
  cursor: Date | null;
  paging: MessagePaging | null;
};

export type D1MessageResult = EffectResult & { replayed?: boolean };

function fail(status: number, error: string): EffectResult {
  return { status, body: { error } };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function jsonArray(value: unknown): unknown[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return typeof value === "string" ? value : new Date(0).toISOString();
}

function attachmentPath(id: string): string {
  return `${MESSAGE_ATTACHMENT_PREFIX}${encodeURIComponent(id)}`;
}

function senderDto(sender: any, familyId: string) {
  if (!sender || sender.family_id !== familyId) return null;
  return {
    id: sender.id,
    name: sender.name,
    avatar_url: sender.avatar_url ?? null,
    role: sender.role,
  };
}

function pickupDto(pickup: any, familyId: string) {
  if (!pickup || pickup.family_id !== familyId) return null;
  const assignee = pickup.assignee && pickup.assignee.family_id === familyId
    ? { id: pickup.assignee.id, name: pickup.assignee.name }
    : null;
  return {
    id: pickup.id,
    title: pickup.title,
    pickup_time: iso(pickup.pickup_time),
    completed: Boolean(pickup.completed),
    assignee,
  };
}

/** Keep exactly the legacy message fields, with private relation projections. */
function messageDto(row: any, familyId: string) {
  const attachments = jsonArray(row.attachments).filter(
    (value): value is string => typeof value === "string" && value.startsWith(MESSAGE_ATTACHMENT_PREFIX),
  );
  const readBy = jsonArray(row.read_by).filter((value): value is string => typeof value === "string");
  return {
    id: row.id,
    family_id: row.family_id,
    sender_id: row.sender_id,
    content: row.content,
    type: row.type,
    attachments,
    read_by: readBy,
    pickup_id: row.pickup_id ?? null,
    created_at: iso(row.created_at),
    sender: senderDto(row.sender, familyId),
    pickup: pickupDto(row.pickup, familyId),
  };
}

export async function authorizeD1Messages(
  db: D1ReadClient,
  actor: D1MessageActor,
): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation)
    return fail(401, "Unauthorized");
  if (!family) return fail(404, "Household not found");
  if (!isFeatureEnabled(normalizeFeatures(parseJson(family.features)), "messages"))
    return fail(403, "This feature is turned off for your family");
  return null;
}

const MESSAGE_SELECT = {
  id: true,
  family_id: true,
  sender_id: true,
  content: true,
  type: true,
  attachments: true,
  read_by: true,
  pickup_id: true,
  created_at: true,
  sender: { select: { id: true, family_id: true, name: true, avatar_url: true, role: true } },
  pickup: {
    select: {
      id: true,
      family_id: true,
      title: true,
      pickup_time: true,
      completed: true,
      assignee: { select: { id: true, family_id: true, name: true } },
    },
  },
} as const;

async function readMessagePage(
  db: D1ReadClient,
  actor: D1MessageActor,
  options: D1MessageReadOptions,
) {
  const denied = await authorizeD1Messages(db, actor);
  if (denied) return { denied } as const;
  const where: any = { family_id: actor.familyId };
  if (options.modern && options.paging?.ok && options.paging.cursor)
    where.AND = [afterMessageCursor(options.paging.cursor)];
  if (!options.modern && options.cursor) where.created_at = { lt: options.cursor };

  const rows = await db.message.findMany({
    where,
    select: MESSAGE_SELECT,
    orderBy: options.modern ? [{ created_at: "desc" }, { id: "asc" }] : { created_at: "desc" },
    take: options.modern ? options.limit + 1 : options.limit,
  });
  const page = options.modern ? rows.slice(0, options.limit) : rows;
  const members = await db.user.findMany({
    where: { family_id: actor.familyId },
    select: { id: true, name: true, role: true, avatar_url: true },
    orderBy: { name: "asc" },
  });
  const messages = page.reverse().map(row => messageDto(row, actor.familyId));
  const last = page[page.length - 1] as any;
  const nextCursor = options.modern && rows.length > options.limit && last
    ? encodeMessageCursor(actor.familyId, { created_at: last.created_at, id: last.id })
    : null;
  return {
    body: {
      messages,
      members,
      userId: actor.userId,
      ...(options.modern
        ? {
            nextCursor,
            readContext: { userId: actor.userId, familyId: actor.familyId },
            writeContext: {
              protocol: "herewoven.message-owner.v1",
              userId: actor.userId,
              familyId: actor.familyId,
              generation: actor.generation,
            } satisfies MessageWriteContext,
          }
        : {}),
    },
  } as const;
}

/** Household-scoped history reader. It rechecks actor authority at the read boundary. */
export async function readD1Messages(
  actor: D1MessageActor,
  options: D1MessageReadOptions,
  database?: D1Store,
): Promise<D1MessageResult> {
  const store = database ?? await getD1Database();
  const session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 8; attempt++) {
    const captured = await captureD1Reads(
      db => readMessagePage(db, actor, options),
      store as unknown as NativeD1,
    );
    try {
      await session.batch(captured.checks(session));
      if (captured.value.denied) return captured.value.denied;
      return { status: 200, body: captured.value.body };
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return fail(409, "Message history changed. Refresh and retry.");
}

/** Mark either a bounded set of rows or the entire household history read. */
export async function markD1MessagesRead(
  actor: D1MessageActor,
  input: { messageIds?: string[]; markAll?: boolean },
  database?: D1Store,
): Promise<D1MessageResult> {
  const store = database ?? await getD1Database();
  const session = store.withSession("first-primary");
  const ids = [...new Set(input.messageIds ?? [])];
  for (let attempt = 0; attempt < 8; attempt++) {
    const captured = await captureD1Reads(async db => authorizeD1Messages(db, actor), store as unknown as NativeD1);
    const checks = captured.checks(session);
    if (captured.value) {
      try { await session.batch(checks); } catch (cause) { if (!isD1WriteConflict(cause)) throw cause; }
      return captured.value;
    }
    {
      try {
        let statement: D1Statement;
        if (input.markAll) {
          statement = session.prepare(`UPDATE "Message"
            SET read_by=json_insert(COALESCE(read_by,'[]'),'$[#]',?1)
            WHERE family_id=?2
              AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(read_by,'[]')) WHERE value=?1)`)
            .bind(actor.userId, actor.familyId);
        } else if (ids.length > 0) {
          // The request contract permits up to 1,000 ids, while D1 limits one
          // statement to 100 bound values. Keep one atomic batch but split the
          // target predicate into sub-queries so a large acknowledgement cannot
          // fail at the edge or force the route to weaken its existing limit.
          const statements: D1Statement[] = [];
          for (let start = 0; start < ids.length; start += 96) {
            const chunk = ids.slice(start, start + 96);
            const placeholders = chunk.map((_, index) => `?${index + 3}`).join(",");
            statements.push(session.prepare(`UPDATE "Message"
              SET read_by=json_insert(COALESCE(read_by,'[]'),'$[#]',?1)
              WHERE family_id=?2 AND id IN (${placeholders})
                AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(read_by,'[]')) WHERE value=?1)`)
              .bind(actor.userId, actor.familyId, ...chunk));
          }
          await session.batch([...checks, ...statements]);
          return { status: 200, body: { success: true } };
        } else {
          await session.batch(checks);
          return { status: 200, body: { success: true } };
        }
        await session.batch([...checks, statement]);
        return { status: 200, body: { success: true } };
      } catch (cause) {
        if (!isD1WriteConflict(cause)) throw cause;
      }
    }
  }
  return fail(409, "Message read state changed. Refresh and retry.");
}

function senderForResponse(user: any) {
  return user ? { id: user.id, name: user.name, avatar_url: user.avatar_url ?? null, role: user.role } : null;
}

async function planSend(
  db: D1ReadClient,
  actor: D1MessageActor,
  body: MessageWriteBody,
  receiptId: string | null,
  now: Date,
): Promise<NativePersonPlan> {
  const denied = await authorizeD1Messages(db, actor);
  if (denied) return denied;
  if (!messageExpectedOwnerMatches(body, actor))
    return { status: 409, body: { error: "Message household changed. Reload before sending.", code: "MESSAGE_OWNER_CHANGED", retryable: false } };
  if (body.issued_at !== undefined && !messageSendWindowOpen(body.issued_at, now.getTime()))
    return messageSendWindowRefusal();

  const sender = await db.user.findFirst({
    where: { id: actor.userId, family_id: actor.familyId },
    select: { id: true, name: true, avatar_url: true, role: true },
  });
  if (!sender) return fail(404, "Message sender is no longer in this family");

  let pickup: any = null;
  if (body.pickup_id) {
    pickup = await db.pickup.findFirst({
      where: { id: body.pickup_id, family_id: actor.familyId },
      select: {
        id: true,
        family_id: true,
        title: true,
        pickup_time: true,
        completed: true,
        assignee: { select: { id: true, family_id: true, name: true } },
      },
    });
    if (!pickup) return fail(404, "Pickup not found");
  }

  const attachmentIds = [...new Set(body.attachment_ids ?? [])];
  const attachments = attachmentIds.length === 0
    ? []
    : await db.messageAttachment.findMany({
        where: { id: { in: attachmentIds }, family_id: actor.familyId, uploaded_by: actor.userId, message_id: null },
        select: { id: true, family_id: true, uploaded_by: true, message_id: true },
      });
  if (attachments.length !== attachmentIds.length) return fail(404, "Message attachment not found");

  const id = randomUUID();
  const attachmentUrls = attachments.map(item => attachmentPath(item.id));
  const response = {
    message: {
      id,
      family_id: actor.familyId,
      sender_id: actor.userId,
      content: body.content,
      type: body.type,
      attachments: attachmentUrls,
      read_by: [actor.userId],
      pickup_id: body.pickup_id ?? null,
      created_at: now.toISOString(),
      sender: senderForResponse(sender),
      pickup: pickupDto(pickup, actor.familyId),
    },
  };
  return {
    status: 200,
    body: response,
    effects: session => {
      const effects: D1Statement[] = [
        session.prepare(`INSERT INTO "Message"
          (id,family_id,sender_id,content,type,attachments,read_by,pickup_id,created_at)
          VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
          .bind(id, actor.familyId, actor.userId, body.content, body.type,
            JSON.stringify(attachmentUrls), JSON.stringify([actor.userId]), body.pickup_id ?? null, now.getTime()),
      ];
      if (attachments.length > 0) {
        const placeholders = attachments.map((_, index) => `?${index + 4}`).join(",");
        const values = attachments.map(item => item.id);
        effects.push(
          session.prepare(`UPDATE "MessageAttachment" SET message_id=?1
            WHERE family_id=?2 AND uploaded_by=?3 AND message_id IS NULL AND id IN (${placeholders})`)
            .bind(id, actor.familyId, actor.userId, ...values),
          d1WriteCheck(session, "changes()=?1", [attachments.length]),
        );
      }
      return effects;
    },
  };
}

/** Send one family message, with receipt replay after current authority. */
export async function sendD1Message(
  actor: D1MessageActor,
  body: MessageWriteBody,
  key: string | null,
  database?: D1Store,
  now = new Date(),
): Promise<D1MessageResult> {
  return executeD1PersonEffect({
    actor,
    action: MESSAGE_ACTION,
    input: body,
    key,
    database,
    now,
    authorize: db => authorizeD1Messages(db, actor),
    plan: (db, receiptId) => planSend(db, actor, body, receiptId, now),
  });
}

