import pg from "pg";
import { assertFixtureTargetAllowed } from "../../src/lib/fixtures/guard";
import { expect } from "./test";

export type OwnedMessage = {
  id: string;
  familyId: string;
  senderId: string;
  content: string;
};

export type OwnedMessageAttachment = {
  id: string;
  familyId: string;
  uploadedBy: string;
  messageId: string | null;
};

export type OwnedMessageReceipt = {
  key: string;
  userId: string;
};

/**
 * Delete only exact message artifacts observed by one authenticated E2E run.
 *
 * This is deliberately fail-closed: every row is checked against the family,
 * actor, body and receipt action before deletion. It never falls back to a
 * family-wide or prefix-based cleanup, so fixture messages and read state are
 * left alone when a test fails halfway through.
 */
export async function removeOwnedMessageArtifacts({
  messages,
  attachments,
  receipts,
}: {
  messages: readonly OwnedMessage[];
  attachments: readonly OwnedMessageAttachment[];
  receipts: readonly OwnedMessageReceipt[];
}) {
  assertFixtureTargetAllowed(process.env);
  const messageIds = [...new Set(messages.map((message) => message.id))];
  const attachmentIds = [...new Set(attachments.map((attachment) => attachment.id))];
  const receiptKeys = [...new Set(receipts.map((receipt) => receipt.key))];
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    const messageRows = messageIds.length
      ? (
          await db.query<{
            id: string;
            family_id: string;
            sender_id: string;
            content: string;
          }>(
            `SELECT id, family_id, sender_id, content
             FROM "Message" WHERE id = ANY($1::text[])`,
            [messageIds],
          )
        ).rows
      : [];
    expect(messageRows).toHaveLength(messageIds.length);
    const expectedMessages = new Map(messages.map((message) => [message.id, message]));
    for (const row of messageRows) {
      const expected = expectedMessages.get(row.id);
      expect(expected).toBeDefined();
      expect(row).toMatchObject({
        family_id: expected?.familyId,
        sender_id: expected?.senderId,
        content: expected?.content,
      });
    }

    const attachmentRows = attachmentIds.length
      ? (
          await db.query<{
            id: string;
            family_id: string;
            uploaded_by: string;
            message_id: string | null;
          }>(
            `SELECT id, family_id, uploaded_by, message_id
             FROM "MessageAttachment" WHERE id = ANY($1::text[])`,
            [attachmentIds],
          )
        ).rows
      : [];
    expect(attachmentRows).toHaveLength(attachmentIds.length);
    const expectedAttachments = new Map(
      attachments.map((attachment) => [attachment.id, attachment]),
    );
    for (const row of attachmentRows) {
      const expected = expectedAttachments.get(row.id);
      expect(expected).toBeDefined();
      expect(row).toMatchObject({
        family_id: expected?.familyId,
        uploaded_by: expected?.uploadedBy,
        message_id: expected?.messageId,
      });
    }

    for (const attachment of attachments) {
      const deleted = await db.query<{ id: string }>(
        `DELETE FROM "MessageAttachment"
         WHERE id = $1 AND family_id = $2 AND uploaded_by = $3
           AND message_id IS NOT DISTINCT FROM $4::text
         RETURNING id`,
        [attachment.id, attachment.familyId, attachment.uploadedBy, attachment.messageId],
      );
      expect(deleted.rows.map((row) => row.id)).toEqual([attachment.id]);
    }

    for (const message of messages) {
      const deleted = await db.query<{ id: string }>(
        `DELETE FROM "Message"
         WHERE id = $1 AND family_id = $2 AND sender_id = $3 AND content = $4
         RETURNING id`,
        [message.id, message.familyId, message.senderId, message.content],
      );
      expect(deleted.rows.map((row) => row.id)).toEqual([message.id]);
    }

    const remainingMessages = messageIds.length
      ? await db.query(`SELECT id FROM "Message" WHERE id = ANY($1::text[])`, [messageIds])
      : { rows: [] };
    expect(remainingMessages.rows).toHaveLength(0);
    const remainingAttachments = attachmentIds.length
      ? await db.query(`SELECT id FROM "MessageAttachment" WHERE id = ANY($1::text[])`, [attachmentIds])
      : { rows: [] };
    expect(remainingAttachments.rows).toHaveLength(0);

    if (receiptKeys.length) {
      const receiptRows = (
        await db.query<{
          id: string;
          key: string;
          family_id: string;
          user_id: string | null;
          action: string;
        }>(
          `SELECT id, key, family_id, user_id, action
           FROM "IdempotencyRecord"
           WHERE key = ANY($1::text[]) AND action = 'message.create'`,
          [receiptKeys],
        )
      ).rows;
      expect(receiptRows).toHaveLength(receiptKeys.length);
      const expectedReceipts = new Map(receipts.map((receipt) => [receipt.key, receipt]));
      for (const row of receiptRows) {
        const expected = expectedReceipts.get(row.key);
        expect(expected).toBeDefined();
        expect(row).toMatchObject({
          family_id: messages.find((message) => message.senderId === expected?.userId)?.familyId,
          user_id: expected?.userId,
          action: "message.create",
        });
      }
      for (const receipt of receipts) {
        const familyId = messages.find((message) => message.senderId === receipt.userId)?.familyId;
        expect(familyId).toBeTruthy();
        const deleted = await db.query<{ id: string }>(
          `DELETE FROM "IdempotencyRecord"
           WHERE key = $1 AND family_id = $2 AND user_id = $3
             AND action = 'message.create'
           RETURNING id`,
          [receipt.key, familyId, receipt.userId],
        );
        expect(deleted.rows).toHaveLength(1);
      }
      const remainingReceipts = await db.query(
        `SELECT key FROM "IdempotencyRecord"
         WHERE key = ANY($1::text[]) AND action = 'message.create'`,
        [receiptKeys],
      );
      expect(remainingReceipts.rows).toHaveLength(0);
    }
  } finally {
    await db.end();
  }
}
