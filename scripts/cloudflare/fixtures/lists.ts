import {
  setD1ListSectionSort,
  moveD1ListItemSection,
} from "../../../src/lib/cloudflare/list-sections";
import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  createD1List,
  createD1ListItem,
  updateD1ListItem,
  deleteD1ListItem,
  resolveD1DefaultGrocery,
} from "../../../src/lib/cloudflare/list-write";
import {
  readD1ListDetail,
  readD1ListOverview,
  readD1ListVersion,
  readD1ListItemsApi,
  readD1ListIndex,
} from "../../../src/lib/cloudflare/list-read";
import { D1PersonReceiptError } from "../../../src/lib/cloudflare/person-effect";
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export async function testLists(db: D1Store) {
  await db.batch([
    db.prepare(
      `INSERT INTO Family(id,name,invite_code,features) VALUES ('lists-a','Lists A','lists-code-a','{"lists":true}'),('lists-b','Lists B','lists-code-b','{"lists":true}')`,
    ),
    db.prepare(
      `INSERT INTO User(id,email,name,role,family_id) VALUES ('lists-parent','lists-parent@example.test','Parent','parent','lists-a'),('lists-child','lists-child@example.test','Child','child','lists-a'),('lists-other','lists-other@example.test','Private','parent','lists-b')`,
    ),
    db.prepare(
      `INSERT INTO Ingredient(id,family_id,name) VALUES ('lists-ingredient','lists-a','Milk'),('lists-foreign-ingredient','lists-b','Private')`,
    ),
  ]);
  const actor = {
      userId: "lists-parent",
      familyId: "lists-a",
      role: "parent",
      generation: 0,
    },
    child = { ...actor, userId: "lists-child", role: "child" },
    foreign = {
      userId: "lists-other",
      familyId: "lists-b",
      role: "parent",
      generation: 0,
    };
  check(
    (
      await createD1List(
        child,
        { name: "Denied", type: "grocery" },
        null,
        undefined,
        db,
      )
    ).status === 403,
    "child cannot create",
  );
  const defaults = await Promise.all(
    [1, 2, 3].map(() => resolveD1DefaultGrocery(actor, db)),
  );
  check(
    new Set(defaults.map((value) => (value.body as any).list.id)).size === 1,
    "one concurrent default",
  );
  const defaultId = (defaults[0].body as any).list.id;
  await db.prepare("DELETE FROM List WHERE id=?1").bind(defaultId).run();
  const realSession = db.withSession("first-primary");
  const failing: D1Store = {
    prepare: db.prepare.bind(db),
    batch: db.batch.bind(db),
    withSession: () => ({
      prepare: realSession.prepare.bind(realSession),
      batch: (statements) =>
        realSession.batch([
          ...statements,
          realSession.prepare(
            "INSERT INTO List(id,family_id,name,type,created_by) VALUES (NULL,NULL,NULL,NULL,NULL)",
          ),
        ]),
    }),
  };
  let rolledBack = false;
  try {
    await createD1List(
      actor,
      { name: "Must roll back", type: "grocery" },
      "lists-rollback",
      undefined,
      failing,
    );
  } catch {
    rolledBack = true;
  }
  check(rolledBack, "injected native SQL failure");
  check(
    !(await db
      .prepare(
        "SELECT id FROM List WHERE family_id=?1 AND name='Must roll back'",
      )
      .bind(actor.familyId)
      .first()),
    "effect rolled back",
  );
  check(
    !(await db
      .prepare(
        "SELECT id FROM IdempotencyRecord WHERE scope=?1 AND key='lists-rollback'",
      )
      .bind("user:" + actor.userId)
      .first()),
    "receipt rolled back",
  );
  const input = { name: "Groceries", type: "grocery" as const };
  const created = await createD1List(
      actor,
      input,
      "lists-create",
      undefined,
      db,
    ),
    list = (created.body as any).list;
  check(
    created.status === 200 && list.family_id === actor.familyId,
    "create list",
  );
  check(
    (await createD1List(actor, input, "lists-create", undefined, db)).replayed,
    "list create replay",
  );
  let reused = false;
  try {
    await createD1List(
      actor,
      { ...input, name: "Other" },
      "lists-create",
      undefined,
      db,
    );
  } catch (error) {
    reused =
      error instanceof D1PersonReceiptError &&
      error.code === "IDEMPOTENCY_KEY_REUSED";
  }
  check(reused, "key reuse refused");
  check(
    (
      await createD1List(
        actor,
        { ...input, image_url: "/api/files/private.jpg" },
        null,
        undefined,
        db,
      )
    ).status === 400,
    "unowned photo refused",
  );
  check(
    (
      await createD1ListItem(
        actor,
        {
          listId: list.id,
          content: "No",
          ingredient_id: "lists-foreign-ingredient",
        },
        null,
        undefined,
        db,
      )
    ).status === 400,
    "foreign ingredient refused",
  );
  const add = {
    listId: list.id,
    content: "Milk",
    quantity: 2,
    ingredient_id: "lists-ingredient",
  };
  const adds = await Promise.all(
    Array.from({ length: 4 }, () =>
      createD1ListItem(child, add, "lists-add", undefined, db),
    ),
  );
  check(
    adds.every((value) => value.status === 200),
    "concurrent add success",
  );
  check(
    new Set(adds.map((value) => (value.body as any).item.id)).size === 1,
    "concurrent add once",
  );
  const item = (adds[0].body as any).item;
  check(
    (
      await setD1ListSectionSort(
        child,
        { listId: list.id, sortBySection: false },
        db,
      )
    ).status === 403,
    "section sort child gate",
  );
  check(
    (
      await setD1ListSectionSort(
        actor,
        { listId: list.id, sortBySection: false },
        db,
      )
    ).status === 200,
    "section sort off",
  );
  check(
    (
      await setD1ListSectionSort(
        foreign,
        { listId: list.id, sortBySection: true },
        db,
      )
    ).status === 404,
    "section sort foreign hidden",
  );
  const moved = await moveD1ListItemSection(
    child,
    { itemId: item.id, section: "pantry" },
    db,
  );
  check(
    moved.status === 200 && (moved.body as any).sections[item.id] === "pantry",
    "member section move",
  );
  check(
    (
      await moveD1ListItemSection(
        foreign,
        { itemId: item.id, section: "frozen" },
        db,
      )
    ).status === 404,
    "foreign section hidden",
  );
  check(
    (await moveD1ListItemSection(actor, { itemId: item.id, section: null }, db))
      .status === 200,
    "clear section",
  );
  const tick = await updateD1ListItem(
    actor,
    { itemId: item.id, checked: true },
    "lists-check",
    "list-item.update",
    db,
  );
  const checked = (tick.body as any).item;
  const noop = await updateD1ListItem(
    child,
    { itemId: item.id, checked: true },
    null,
    "list-item.update",
    db,
  );
  check(
    (noop.body as any).item.checked_by === actor.userId &&
      (noop.body as any).item.updated_at.getTime() ===
        checked.updated_at.getTime(),
    "same-state retains attribution/version",
  );
  check(
    (
      await updateD1ListItem(
        actor,
        { itemId: item.id, checked: true },
        "lists-check",
        "list-item.update",
        db,
      )
    ).replayed,
    "tick replay",
  );
  check(
    (
      await updateD1ListItem(
        actor,
        {
          itemId: item.id,
          content: "Stale",
          expectedUpdatedAt: item.updated_at,
        },
        "lists-stale",
        "list-item.edit",
        db,
      )
    ).status === 409,
    "stale edit refused",
  );
  const edit = {
    itemId: item.id,
    content: "Oat milk",
    quantity: 3,
    expectedUpdatedAt: checked.updated_at.toISOString(),
  };
  check(
    (await updateD1ListItem(actor, edit, "lists-edit", "list-item.edit", db))
      .status === 200,
    "versioned edit",
  );
  check(
    (await updateD1ListItem(actor, edit, "lists-edit", "list-item.edit", db))
      .replayed,
    "edit recovers before version conflict",
  );
  check(
    (
      await updateD1ListItem(
        foreign,
        { itemId: item.id, checked: false },
        null,
        "list-item.update",
        db,
      )
    ).status === 403,
    "foreign update refused",
  );
  const paging = {
    ok: true as const,
    paged: true as const,
    limit: 1,
    cursor: null,
  };
  const overview = await readD1ListOverview(actor, { type: null, paging }, db);
  check(
    overview?.lists.length === 1 &&
      overview.lists[0].total_count === 1 &&
      overview.lists[0].checked_count === 1,
    "overview counts",
  );
  const detail = await readD1ListDetail(actor, list.id, paging, db);
  check(
    detail.state === "available" &&
      detail.items[0].content === "Oat milk" &&
      detail.items[0].adder.name === "Child",
    "detail hydrated",
  );
  check(
    (await readD1ListDetail(foreign, list.id, paging, db)).state === "missing",
    "detail isolation",
  );
  const version = await readD1ListVersion(actor, list.id, paging, db);
  check(
    version.status === 200 && (version.body as any).version === detail.version,
    "exact page version",
  );
  const api = await readD1ListItemsApi(actor, list.id, paging, db);
  check(
    api.status === 200 &&
      (api.body as any).items[0].section &&
      (api.body as any).sectionSort.enabled === false,
    "legacy items section",
  );
  check(
    (await readD1ListIndex(actor, null, { ok: true, paged: false }, db))
      .status === 200,
    "legacy list summaries",
  );
  const trips = await db
    .prepare("SELECT sections FROM GroceryShoppingSession WHERE family_id=?1")
    .bind(actor.familyId)
    .all<{ sections: string }>();
  check(
    trips.results.length === 1 &&
      JSON.parse(trips.results[0].sections).length === 1,
    "one real tick trip",
  );
  // No-key creates stay distinct, position allocation is witnessed under races.
  const distinct = await Promise.all(
    [1, 2, 3].map(() =>
      createD1ListItem(
        actor,
        { listId: list.id, content: "Apples" },
        null,
        undefined,
        db,
      ),
    ),
  );
  check(
    new Set(distinct.map((value) => (value.body as any).item.position)).size ===
      3,
    "concurrent positions distinct",
  );
  check(
    (await readD1ListDetail(actor, list.id, paging, db)).state === "available",
    "paged detail",
  );
  const alias = await createD1ListItem(
    actor,
    {
      listId: list.id,
      content: "Milk for soup",
      ingredient_id: "lists-ingredient",
    },
    null,
    undefined,
    db,
  );
  const aliasId = (alias.body as any).item.id;
  const aliasMove = await moveD1ListItemSection(
    actor,
    { itemId: item.id, section: "pantry" },
    db,
  );
  check(
    aliasMove.status === 200 &&
      (aliasMove.body as any).sections[aliasId] === "pantry",
    "ingredient aliases follow section",
  );
  check(
    (
      await db
        .prepare("SELECT section FROM Ingredient WHERE id=?1 AND family_id=?2")
        .bind("lists-ingredient", actor.familyId)
        .first<{ section: string }>()
    )?.section === "pantry",
    "ingredient section persisted",
  );
  check(
    (await deleteD1ListItem(child, item.id, db)).status === 403,
    "parent delete gate",
  );
  check(
    (await deleteD1ListItem(foreign, item.id, db)).status === 404,
    "foreign delete hidden",
  );
  check(
    (await deleteD1ListItem(actor, item.id, db)).status === 200,
    "owned delete",
  );
  // Role changes must block historical receipts too.
  await db
    .prepare("UPDATE User SET role='child' WHERE id=?1")
    .bind(actor.userId)
    .run();
  check(
    (await createD1List(actor, input, "lists-create", undefined, db)).status ===
      401,
    "authority before receipt",
  );
  return {
    lists: "native create/read/edit/check/delete",
    isolation: true,
    concurrency: true,
    receiptRecovery: true,
    walkingOrder: true,
    sectionControls: true,
  };
}
