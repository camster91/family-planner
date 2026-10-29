import {
  createD1Note,
  deleteD1Note,
  inspectD1NoteReceipt,
  readD1Notes,
  readD1NoteRecovery,
  updateD1Note,
  createD1Project,
  createD1ProjectTask,
  deleteD1Project,
  deleteD1ProjectTask,
  readD1Project,
  readD1Projects,
  readD1ProjectTasks,
  sendD1ProjectToCalendar,
  updateD1Project,
  updateD1ProjectTask,
} from "../../../src/lib/cloudflare/notes-projects";
import type { D1Store } from "../../../src/lib/cloudflare/database";

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

const parent = { userId: "notes-parent", familyId: "notes-family-a", role: "parent", generation: 0 } as const;
const child = { userId: "notes-child", familyId: "notes-family-a", role: "child", generation: 0 } as const;
const foreign = { userId: "notes-foreign", familyId: "notes-family-b", role: "parent", generation: 0 } as const;
const features = JSON.stringify({ notes: true, projects: true, calendar: true });

/** Disposable native coverage for notes, projects, task/calendar handoff and household isolation. */
export async function testNotesProjects(db: D1Store) {
  const now = Date.parse("2026-10-28T16:00:00.000Z");
  await db.batch([
    db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('notes-family-a','Notes A','notes-code-a',?1),('notes-family-b','Notes B','notes-code-b',?1)`).bind(features),
    db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,token_version) VALUES
      ('notes-parent','notes-parent@example.test','Notes Parent','notes-family-a','parent',0),
      ('notes-child','notes-child@example.test','Notes Child','notes-family-a','child',0),
      ('notes-foreign','notes-foreign@example.test','Other Parent','notes-family-b','parent',0)`),
    db.prepare(`INSERT INTO "PinnedNote"(id,family_id,title,body,color,pinned,created_by,created_at,updated_at) VALUES ('notes-existing','notes-family-a','Existing','Keep this','blue',1,'notes-parent',?1,?1)`).bind(now),
    db.prepare(`INSERT INTO "Project"(id,family_id,name,description,status,color,created_by,created_at,updated_at) VALUES ('notes-project','notes-family-a','Kitchen','Paint and repair','active','#3B82F6','notes-parent',?1,?1),('notes-foreign-project','notes-family-b','Private','Other','active','#3B82F6','notes-foreign',?1,?1)`).bind(now),
    db.prepare(`INSERT INTO "ProjectTask"(id,project_id,title,description,completed,assigned_to,due_date,position,created_at,updated_at) VALUES ('notes-task-existing','notes-project','Measure wall','Bring tape',0,'notes-child',?1,0,?2,?2)`).bind(Date.parse("2026-11-01T00:00:00.000Z"), now),
  ]);

  const notes = await readD1Notes(parent, { ok: true, paged: false }, db);
  check(notes.status === 200 && (notes.body as any).notes.length === 1, "notes read stays in household");
  check((await readD1Notes(foreign, { ok: true, paged: false }, db)).status === 200, "foreign notes read is independently scoped");

  const createInput = { title: "Weekend plan", body: "Paint the hallway", color: "green", expected_user_id: parent.userId, expected_family_id: parent.familyId };
  const created = await createD1Note(parent, createInput, "notes-create-key", undefined, db);
  check(created.status === 201 && (created.body as any).note.family_id === parent.familyId, "note create");
  const replay = await createD1Note(parent, createInput, "notes-create-key", undefined, db);
  check(replay.replayed && JSON.stringify(replay.body) === JSON.stringify(created.body), "note create replay preserves body");
  check(((await inspectD1NoteReceipt(parent, "notes-create-key", createInput, db)).body as any).state === "present", "note receipt confirms target");
  const noteId = (created.body as any).note.id as string;
  const noteRow = await db.prepare(`SELECT updated_at FROM "PinnedNote" WHERE id=?1`).bind(noteId).first<{ updated_at: number }>();
  const edited = await updateD1Note(parent, { id: noteId, title: "Weekend plan updated", expected_updated_at: new Date(Number(noteRow!.updated_at)).toISOString() }, db);
  check(edited.status === 200 && (edited.body as any).note.title === "Weekend plan updated", "note optimistic update");
  check((await updateD1Note(child, { id: "notes-existing", title: "No" }, db)).status === 403, "child cannot edit a note they did not create");
  check((await deleteD1Note(child, noteId, db)).status === 403, "child cannot delete notes");
  check((await deleteD1Note(parent, noteId, db)).status === 200, "parent deletes note");
  check(((await inspectD1NoteReceipt(parent, "notes-create-key", createInput, db)).body as any).state === "removed", "receipt reports removed note");
  const recovery = await readD1NoteRecovery(parent, { enabled: false, owner: null }, db);
  check(recovery.status === 200 && (recovery.body as any).contract === "herewoven.note-create-recovery.v1", "native recovery read is feature-authorized");

  const projects = await readD1Projects(parent, { status: null }, { ok: true, paged: false }, db);
  check(projects.status === 200 && (projects.body as any).projects.length === 1, "project list isolates household");
  const projectInput = { name: "Backyard", description: "Build a small deck", status: "active", color: "#22C55E" };
  const projectCreate = await createD1Project(parent, projectInput, "project-create-key", db);
  check(projectCreate.status === 201, "project create");
  const projectReplay = await createD1Project(parent, projectInput, "project-create-key", db);
  check(projectReplay.replayed && JSON.stringify(projectReplay.body) === JSON.stringify(projectCreate.body), "project create replay preserves body");
  const projectId = (projectCreate.body as any).project.id as string;
  const taskInput = { title: "Order lumber", description: "Use the family account", assigned_to: child.userId, due_date: "2026-11-05T00:00:00.000Z" };
  const taskCreate = await createD1ProjectTask(child, projectId, taskInput, "task-create-key", db);
  check(taskCreate.status === 201, "child can create project task");
  const taskId = (taskCreate.body as any).task.id as string;
  const taskReplay = await createD1ProjectTask(child, projectId, taskInput, "task-create-key", db);
  check(taskReplay.replayed && JSON.stringify(taskReplay.body) === JSON.stringify(taskCreate.body), "task create replay preserves body");
  const taskPage = await readD1ProjectTasks(parent, projectId, null, { ok: true, paged: false }, db);
  check(taskPage.status === 200 && (taskPage.body as any).tasks.length === 1, "task read");
  const updatedTask = await updateD1ProjectTask(parent, projectId, taskId, { assigned_to: null, completed: true }, db);
  check(updatedTask.status === 200 && (updatedTask.body as any).task.assignee === null, "task unassign clears projected assignee");
  check((await updateD1Project(parent, projectId, { name: "Backyard updated" }, db)).status === 200, "project update");

  const calendarProject = "notes-calendar-project";
  await db.prepare(`INSERT INTO "Project"(id,family_id,name,status,color,created_by,created_at,updated_at) VALUES (?1,?2,'Calendar project','active','#3B82F6',?3,?4,?4)`).bind(calendarProject, parent.familyId, parent.userId, now).run();
  await db.prepare(`INSERT INTO "ProjectTask"(id,project_id,title,description,completed,due_date,position,created_at,updated_at) VALUES ('notes-calendar-task-a',?1,'School pickup',NULL,0,?2,0,?3,?3),('notes-calendar-task-b',?1,'Pack lunch',NULL,0,?4,1,?3,?3)`).bind(calendarProject, Date.parse("2026-11-02T00:00:00.000Z"), now, Date.parse("2026-11-03T00:00:00.000Z")).run();
  const sent = await sendD1ProjectToCalendar(parent, calendarProject, "America/Toronto", false, db);
  check(sent.status === 200 && (sent.body as any).eventsCreated === 2, "project tasks send to calendar");
  const summary = await sendD1ProjectToCalendar(parent, calendarProject, "America/Toronto", true, db);
  check(summary.status === 200 && (summary.body as any).state === "all-sent", "calendar send is idempotent");
  check((await db.prepare(`SELECT count(*) AS n FROM "Event" WHERE project_id=?1 AND family_id=?2`).bind(calendarProject, parent.familyId).first<{ n: number }>())!.n === 2, "calendar events remain family scoped");

  check((await deleteD1ProjectTask(parent, projectId, taskId, db)).status === 200, "parent deletes task");
  check((await deleteD1Project(parent, projectId, db)).status === 200, "parent deletes project and cascades tasks");
  check((await readD1Project(parent, projectId, db)).status === 404, "deleted project is not readable");
  check((await readD1Project(foreign, "notes-project", db)).status === 404, "foreign project is hidden");

  return { notes: true, noteReceipts: true, noteRecovery: true, projects: true, tasks: true, calendarHandoff: true, householdIsolation: true };
}
