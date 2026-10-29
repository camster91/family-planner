import {
  createD1CapturedGrocery,
  executeD1AssistantAction,
} from "../../../src/lib/cloudflare/assistant-actions";
import type { D1Store } from "../../../src/lib/cloudflare/database";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const parent = {
  userId: "assistant-action-parent",
  familyId: "assistant-action-family-a",
  role: "parent",
  generation: 0,
  name: "Assistant Parent",
} as const;
const child = {
  userId: "assistant-action-child",
  familyId: "assistant-action-family-a",
  role: "child",
  generation: 0,
  name: "Assistant Child",
} as const;

/** Native assistant effects with fabricated households; no provider calls. */
export async function testAssistantActions(db: D1Store) {
  const features = JSON.stringify({
    calendar: true,
    chores: true,
    lists: true,
    notes: true,
  });
  await db.batch([
    db
      .prepare(
        `INSERT INTO Family(id,name,invite_code,features) VALUES (?1,?2,?3,?4),('assistant-action-family-b','Other','assistant-action-code-b',?4)`,
      )
      .bind(
        parent.familyId,
        "Assistant household",
        "assistant-action-code-a",
        features,
      ),
    db
      .prepare(
        `INSERT INTO User(id,email,name,role,family_id,email_verified,token_version) VALUES
      (?1,'assistant-action-parent@example.test',?2,'parent',?3,1,0),
      (?4,'assistant-action-child@example.test',?5,'child',?3,1,0),
      ('assistant-action-other','assistant-action-other@example.test','Other','parent','assistant-action-family-b',1,0)`,
      )
      .bind(
        parent.userId,
        parent.name,
        parent.familyId,
        child.userId,
        child.name,
      ),
  ]);

  const list = await executeD1AssistantAction(
    parent,
    {
      kind: "list_create",
      body: { name: "Family groceries", type: "grocery" },
    },
    "assistant-action-list-key",
    { database: db },
  );
  check(list.status === 200 && !list.replayed, "assistant list create");
  const listId = (list.body as { list: { id: string } }).list.id;
  const listReplay = await executeD1AssistantAction(
    parent,
    {
      kind: "list_create",
      body: { name: "Family groceries", type: "grocery" },
    },
    "assistant-action-list-key",
    { database: db },
  );
  check(listReplay.replayed, "assistant list replay");

  const grocery = await executeD1AssistantAction(
    parent,
    {
      kind: "grocery_add",
      body: { listId, content: "Milk", quantity: 2 },
    },
    "assistant-action-item-key",
    { database: db },
  );
  check(grocery.status === 200, "assistant grocery add");
  const captured = await createD1CapturedGrocery(
    parent,
    { content: "Eggs", quantity: 1 },
    "assistant-action-capture-key",
    db,
  );
  check(captured.status === 200, "capture grocery default list");

  const event = await executeD1AssistantAction(
    parent,
    {
      kind: "event_create",
      body: {
        title: "Family appointment",
        start_time: "2026-10-28T16:00:00.000Z",
        end_time: "2026-10-28T17:00:00.000Z",
        event_type: "family",
      },
    },
    "assistant-action-event-key",
    { database: db },
  );
  check(event.status === 200, "assistant event create");

  const note = await executeD1AssistantAction(
    parent,
    {
      kind: "note_create",
      body: { title: "Fridge", body: "Use the leftovers." },
    },
    "assistant-action-note-key",
    { database: db },
  );
  check(note.status === 201, "assistant note create");
  const childDenied = await executeD1AssistantAction(
    child,
    { kind: "list_create", body: { name: "Not allowed", type: "todo" } },
    "assistant-action-child-key",
    { database: db },
  );
  check(childDenied.status === 403, "child assistant list refusal");

  return {
    list: true,
    listReplay: true,
    grocery: true,
    capturedGrocery: true,
    event: true,
    note: true,
    childRoleGate: true,
  };
}
