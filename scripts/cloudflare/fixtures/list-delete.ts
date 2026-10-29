import { loadD1AssistantTodayContext } from "../../../src/lib/cloudflare/assistant-context";
import {
  referenceAssistantToday,
  type AssistantSourceRow,
} from "../../../src/lib/assistant-references";
import {
  assistantSourceGuard,
  issueAssistantSourceProof,
} from "../../../src/lib/assistant-source-proof";
import { normalizeFeatures } from "../../../src/lib/features";
import { reviewD1DeleteTarget } from "../../../src/lib/cloudflare/assistant-delete-target";
import type { D1Store } from "../../../src/lib/cloudflare/database";
import { deleteD1List } from "../../../src/lib/cloudflare/list-delete";
import { readD1ListDeleteSnapshot } from "../../../src/lib/cloudflare/assistant-delete-target";
import {
  withD1ReadClient,
  type NativeD1,
} from "../../../src/lib/cloudflare/read-client";
import {
  assistantDeleteTargetGuard,
  issueDeleteTargetProof,
} from "../../../src/lib/assistant-delete-target";
import { ASSISTANT_TARGET_PROOF_HEADER } from "../../../src/lib/assistant-reference-contract";
import { AssistantSourceRefused } from "../../../src/lib/assistant-source-proof";
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function testListDelete(db: D1Store) {
  const previousReferences = process.env.FAMILY_ASSISTANT_REFERENCES_READY,
    previousToday = process.env.ASSISTANT_TODAY_ENABLED;
  process.env.FAMILY_ASSISTANT_REFERENCES_READY = "1";
  process.env.ASSISTANT_TODAY_ENABLED = "1";
  const previousSecret = process.env.JWT_SECRET,
    previousReady = process.env.FAMILY_ASSISTANT_CONFIRMATION_READY;
  process.env.JWT_SECRET = "fabricated-list-delete-secret-not-real";
  process.env.FAMILY_ASSISTANT_CONFIRMATION_READY = "1";
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO Family(id,name,invite_code,features) VALUES ('ld-a','Delete A','ld-code-a','{"lists":true}'),('ld-b','Delete B','ld-code-b','{"lists":true}')`,
      ),
      db.prepare(
        `INSERT INTO User(id,email,name,role,family_id) VALUES ('ld-parent','ld-parent@example.test','Parent','parent','ld-a'),('ld-teen','ld-teen@example.test','Teen','teen','ld-a'),('ld-other','ld-other@example.test','Other','parent','ld-b')`,
      ),
    ]);
    const actor = {
        userId: "ld-parent",
        familyId: "ld-a",
        role: "parent",
        generation: 0,
      },
      foreign = {
        userId: "ld-other",
        familyId: "ld-b",
        role: "parent",
        generation: 0,
      };
    async function seed(id: string) {
      await db.batch([
        db
          .prepare(
            "INSERT INTO List(id,family_id,name,type,created_by) VALUES (?1,'ld-a','Delete this list','grocery','ld-parent')",
          )
          .bind(id),
        db
          .prepare(
            "INSERT INTO ListItem(id,list_id,content,added_by) VALUES (?1,?2,'Milk','ld-parent')",
          )
          .bind(id + "-item", id),
        db
          .prepare(
            "INSERT INTO GroceryShoppingSession(id,list_id,family_id,sections) VALUES (?1,?2,'ld-a','[\"dairy_eggs\"]')",
          )
          .bind(id + "-trip", id),
      ]);
    }
    async function target(id: string, issuedAt = Date.now()) {
      const snapshot = await withD1ReadClient(
        (read) => readD1ListDeleteSnapshot(read, actor.familyId, id),
        db as unknown as NativeD1,
      );
      check(snapshot, "target snapshot");
      return assistantDeleteTargetGuard(
        {
          headers: new Headers({
            [ASSISTANT_TARGET_PROOF_HEADER]: issueDeleteTargetProof(
              actor,
              "list_delete",
              id,
              snapshot,
              issuedAt,
            ),
          }),
        },
        actor,
        "list_delete",
        id,
        false,
      )!;
    }
    await seed("ld-concurrent");
    check(
      (
        await deleteD1List(
          { ...actor, userId: "ld-teen", role: "teen" },
          "ld-concurrent",
          null,
          { database: db },
        )
      ).status === 403,
      "parent-only container delete",
    );
    check(
      (await deleteD1List(foreign, "ld-concurrent", null, { database: db }))
        .status === 403,
      "foreign container denied",
    );
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        deleteD1List(actor, "ld-concurrent", "ld-delete", { database: db }),
      ),
    );
    check(
      results.every((value) => value.status === 200) &&
        results.filter((value) => !value.replayed).length === 1,
      "concurrent deletion once",
    );
    check(
      !(await db
        .prepare("SELECT id FROM ListItem WHERE list_id=?1")
        .bind("ld-concurrent")
        .first()) &&
        !(await db
          .prepare("SELECT id FROM GroceryShoppingSession WHERE list_id=?1")
          .bind("ld-concurrent")
          .first()),
      "native child cascades",
    );
    await seed("ld-target-race");
    const raceTarget = await target("ld-target-race");
    const targetRace = await Promise.all(
      [1, 2, 3, 4].map(() =>
        deleteD1List(actor, "ld-target-race", "ld-target-race-key", {
          database: db,
          targetGuard: raceTarget,
        }),
      ),
    );
    check(
      targetRace.every((value) => value.status === 200) &&
        targetRace.filter((value) => !value.replayed).length === 1,
      "same target proof race recovers committed receipt",
    );
    await seed("ld-exact");
    const exact = await target("ld-exact");
    check(
      (
        await deleteD1List(actor, "ld-exact", "ld-exact-key", {
          database: db,
          targetGuard: exact,
        })
      ).status === 200,
      "exact target accepted",
    );
    check(
      (
        await deleteD1List(actor, "ld-exact", "ld-exact-key", {
          database: db,
          targetGuard: exact,
        })
      ).replayed,
      "completed target replay after cascade",
    );
    await seed("ld-reviewed");
    let sources: AssistantSourceRow[] = [];
    const contextInput = {
      ...actor,
      serverNow: new Date(),
      viewerTimeZone: "UTC",
      surface: "person" as const,
      materializeSeries: false,
      onSources(rows: AssistantSourceRow[]) {
        sources = rows;
      },
    };
    const context = await loadD1AssistantTodayContext(
        contextInput,
        db as unknown as NativeD1,
      ),
      reference = referenceAssistantToday(context, sources, contextInput);
    check(reference, "list source reference");
    const sourceToken = issueAssistantSourceProof(
      actor,
      "list_delete",
      reference.context,
      reference.catalog,
      normalizeFeatures({ lists: true }),
    );
    const source = assistantSourceGuard(
      { headers: new Headers({ "X-Assistant-Source-Proof": sourceToken }) },
      actor,
      "list_delete",
    )!;
    const review = await reviewD1DeleteTarget(
      actor,
      "list_delete",
      "ld-reviewed",
      source,
      db,
    );
    check(
      review.status === 200 &&
        (review.body as any).target.title === "Delete this list",
      "list target review",
    );
    const reviewedTarget = assistantDeleteTargetGuard(
      {
        headers: new Headers({
          [ASSISTANT_TARGET_PROOF_HEADER]: (review.body as any).target.proof,
        }),
      },
      actor,
      "list_delete",
      "ld-reviewed",
      true,
    )!;
    check(
      (
        await deleteD1List(actor, "ld-reviewed", "ld-reviewed-key", {
          database: db,
          sourceGuard: source,
          targetGuard: reviewedTarget,
        })
      ).status === 200,
      "reviewed source and target delete",
    );
    await seed("ld-stale");
    const stale = await target("ld-stale");
    await db
      .prepare(
        "UPDATE ListItem SET content='Changed without a timestamp' WHERE id=?1",
      )
      .bind("ld-stale-item")
      .run();
    let refused = false;
    try {
      await deleteD1List(actor, "ld-stale", "ld-stale-key", {
        database: db,
        targetGuard: stale,
      });
    } catch (error) {
      refused = error instanceof AssistantSourceRefused;
    }
    check(refused, "changed child refuses exact proof");
    check(
      await db
        .prepare("SELECT id FROM List WHERE id=?1")
        .bind("ld-stale")
        .first(),
      "stale target retained",
    );
    const expired = await target("ld-stale", Date.now() - 61000);
    refused = false;
    try {
      await deleteD1List(actor, "ld-stale", null, {
        database: db,
        targetGuard: expired,
      });
    } catch (error) {
      refused = error instanceof AssistantSourceRefused;
    }
    check(refused, "expired new effect refused");
    await db
      .prepare("UPDATE User SET token_version=1 WHERE id=?1")
      .bind(actor.userId)
      .run();
    check(
      (
        await deleteD1List(actor, "ld-concurrent", "ld-delete", {
          database: db,
        })
      ).status === 401,
      "renewed authority before replay",
    );
    return {
      listDelete: true,
      exactTarget: true,
      changedChildRefused: true,
      cascades: true,
      concurrentReceipt: true,
    };
  } finally {
    if (previousReferences === undefined)
      delete process.env.FAMILY_ASSISTANT_REFERENCES_READY;
    else process.env.FAMILY_ASSISTANT_REFERENCES_READY = previousReferences;
    if (previousToday === undefined) delete process.env.ASSISTANT_TODAY_ENABLED;
    else process.env.ASSISTANT_TODAY_ENABLED = previousToday;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousReady === undefined)
      delete process.env.FAMILY_ASSISTANT_CONFIRMATION_READY;
    else process.env.FAMILY_ASSISTANT_CONFIRMATION_READY = previousReady;
  }
}
