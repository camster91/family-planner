import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  getPrivateObjectStore,
  privateObjectGenerationKey,
} from "../../../src/lib/cloudflare/storage";
import {
  canD1FamilyReadChorePhoto,
  pruneD1UnreferencedUploads,
  storeD1ChoreUpload,
} from "../../../src/lib/cloudflare/uploads";
import {
  getD1MessageAttachment,
  pruneD1MessageAttachments,
  storeD1MessageAttachment,
} from "../../../src/lib/cloudflare/message-attachments";
import { sendD1Message } from "../../../src/lib/cloudflare/messages";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Real local R2 + D1 bindings; no map/double, remote bucket or real media. */
export async function testR2Storage(db: D1Store) {
  const bucket = await getPrivateObjectStore();
  await db.batch([
    db.prepare(`INSERT INTO Family(id,name,invite_code,features) VALUES
      ('r2-family-a','R2 A','r2-code-a','{"messages":true}'),
      ('r2-family-b','R2 B','r2-code-b','{"messages":true}')`),
    db.prepare(`INSERT INTO User(id,email,name,role,family_id) VALUES
      ('r2-parent-a','r2-a@example.test','R2 Parent A','parent','r2-family-a'),
      ('r2-parent-b','r2-b@example.test','R2 Parent B','parent','r2-family-b')`),
  ]);
  const actor = {
    userId: "r2-parent-a",
    familyId: "r2-family-a",
    role: "parent",
    generation: 0,
  };
  const bytes = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGU0AAAAASUVORK5CYII=",
    ),
    (value) => value.charCodeAt(0),
  );
  const filename = "a1b2c3d4e5f60718.png";
  const upload = await storeD1ChoreUpload({
    actor,
    bytes,
    filename,
    contentType: "image/png",
    bucket,
    database: db,
  });
  check(upload.kind === "ok" && upload.created, "real R2 upload admitted");
  const key = privateObjectGenerationKey(
    actor.familyId,
    "chores",
    filename,
    upload.row.id,
  );
  const object = await bucket.get(key);
  check(
    object && object.httpMetadata?.contentType === "image/png",
    "R2 HTTP metadata preserved",
  );
  const stored = new Uint8Array(await object.arrayBuffer());
  check(
    stored.length === bytes.length &&
      stored.every((value, index) => value === bytes[index]),
    "R2 media bytes preserved",
  );
  check(
    await canD1FamilyReadChorePhoto(actor.familyId, filename, db),
    "own upload readable",
  );
  check(
    !(await canD1FamilyReadChorePhoto("r2-family-b", filename, db)),
    "foreign upload refused before object access",
  );
  const replay = await storeD1ChoreUpload({
    actor,
    bytes,
    filename,
    contentType: "image/png",
    bucket,
    database: db,
  });
  check(
    replay.kind === "ok" && !replay.created && replay.row.id === upload.row.id,
    "real R2 dedupe retains generation",
  );

  const attachment = await storeD1MessageAttachment({
    familyId: actor.familyId,
    userId: actor.userId,
    generation: 0,
    bytes,
    contentType: "image/png",
    ext: "png",
    bucket,
    database: db,
  });
  check(
    (await getD1MessageAttachment(actor.familyId, attachment.id, db)) === null,
    "unclaimed media is not served",
  );
  const sent = await sendD1Message(
    actor,
    {
      content: "Fabricated private photo",
      type: "text",
      attachment_ids: [attachment.id],
      issued_at: new Date().toISOString(),
      expected_user_id: actor.userId,
      expected_family_id: actor.familyId,
      expected_generation: 0,
    },
    "r2-message-key-001",
    db,
  );
  check(sent.status === 200, "message atomically claims real R2 upload");
  check(
    await getD1MessageAttachment(actor.familyId, attachment.id, db),
    "claimed attachment readable",
  );
  check(
    (await getD1MessageAttachment("r2-family-b", attachment.id, db)) === null,
    "foreign message media refused",
  );
  const messageKey = privateObjectGenerationKey(
    actor.familyId,
    "messages",
    attachment.filename,
    attachment.id,
  );
  check(await bucket.head(messageKey), "claimed R2 object exists");
  await pruneD1MessageAttachments({
    familyId: actor.familyId,
    bucket,
    database: db,
    now: Date.now() + 40 * 86400000,
  });
  check(await bucket.head(messageKey), "cleanup retains claimed message media");
  check(
    (await pruneD1UnreferencedUploads({
      familyId: actor.familyId,
      bucket,
      database: db,
      now: Date.now() + 40 * 86400000,
    })) === 1,
    "unreferenced real R2 chore upload retired",
  );
  check(
    (await bucket.head(key)) === null,
    "retired object deleted from real local bucket",
  );
  return {
    realLocalR2: true,
    bytes: true,
    metadata: true,
    isolation: true,
    dedupe: true,
    messageClaim: true,
    cleanup: true,
  };
}
