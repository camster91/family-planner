// pruneUnreferencedUploads: a photo referenced after the candidate read (board
// pick, chore or assignment attach) is never removed, because the delete runs
// under the household and Family row locks and re-reads every reference.

jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));

import path from "path";
import { db, fakePrisma, FAMILY_A, FAMILY_B } from "@/__tests__/helpers/two-household";
import { pruneUnreferencedUploads, STALE_UPLOAD_AGE_MS } from "@/lib/upload-housekeeping";

const UPLOAD_DIR = "/uploads";
const OLD = new Date(Date.now() - STALE_UPLOAD_AGE_MS - 60_000);

let seq = 0;
function seedUpload(family_id = FAMILY_A) {
  seq += 1;
  const row = {
    id: `up-${seq}`, family_id, uploaded_by: null, filename: `${seq.toString(16).padStart(16, "0")}.jpg`,
    content_type: "image/jpeg", size_bytes: 100, created_at: OLD,
  };
  db.rows("upload").push(row);
  return row;
}

type Step = string;

/**
 * The fake client, with a hook that runs right after the candidate read (the
 * first upload.findMany) — i.e. a write that commits between the cleanup's
 * read and its delete — and a log of lock statements and deletes.
 */
function racingDb(afterCandidateRead: () => void) {
  const steps: Step[] = [];
  let first = true;
  const client: any = {
    upload: {
      ...fakePrisma.upload,
      findMany: async (args: any) => {
        const rows = await fakePrisma.upload.findMany(args);
        if (first) {
          first = false;
          afterCandidateRead();
        }
        return rows;
      },
      deleteMany: async (args: any) => {
        steps.push("delete");
        return fakePrisma.upload.deleteMany(args);
      },
    },
    list: fakePrisma.list,
    chore: fakePrisma.chore,
    choreAssignment: fakePrisma.choreAssignment,
    family: fakePrisma.family,
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      steps.push(sql.includes("pg_advisory_xact_lock") ? "household-lock" : sql.includes("FOR UPDATE") ? "family-row-lock" : sql);
      return [];
    },
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      steps.push("begin");
      const out = await fn(client);
      steps.push("commit");
      return out;
    },
  };
  return { client, steps };
}

async function prune(client: any) {
  const removedFiles: string[] = [];
  const count = await pruneUnreferencedUploads(client, FAMILY_A, {
    uploadDir: UPLOAD_DIR,
    removeFile: async (p) => {
      removedFiles.push(path.basename(p));
    },
  });
  return { count, removedFiles };
}

const ids = () => db.rows("upload").map((r: any) => r.id);

describe("pruneUnreferencedUploads — concurrent references", () => {
  beforeEach(() => {
    db.reset();
    seq = 0;
  });

  it("removes an unreferenced stale upload under the household lock, then the Family row lock", async () => {
    const stale = seedUpload();
    const foreign = seedUpload(FAMILY_B);
    const { client, steps } = racingDb(() => undefined);

    const { count, removedFiles } = await prune(client);

    expect(count).toBe(1);
    expect(removedFiles).toEqual([stale.filename]);
    expect(ids()).toEqual([foreign.id]);
    expect(steps).toEqual(["begin", "household-lock", "family-row-lock", "delete", "commit"]);
  });

  it("keeps a photo picked for the board after the candidate read", async () => {
    const picked = seedUpload();
    const other = seedUpload();
    const { client } = racingDb(() => {
      db.rows("family").find((f: any) => f.id === FAMILY_A)!.ambient_photo_ids = [picked.id];
    });

    const { count, removedFiles } = await prune(client);

    expect(count).toBe(1);
    expect(ids()).toContain(picked.id);
    expect(ids()).not.toContain(other.id);
    expect(removedFiles).toEqual([other.filename]);
  });

  it.each([
    ["canonical chore path", (f: string) => `/api/files/chores/${f}`],
    ["legacy path", (f: string) => `/api/files/${f}`],
    ["bare filename", (f: string) => f],
  ])("keeps a photo attached to a chore after the candidate read (%s)", async (_label, spell) => {
    const attached = seedUpload();
    const { client } = racingDb(() => {
      db.rows("chore").find((c: any) => c.id === "chore-a")!.photo_url = spell(attached.filename);
    });

    const { count, removedFiles } = await prune(client);

    expect(count).toBe(0);
    expect(ids()).toContain(attached.id);
    expect(removedFiles).toEqual([]);
  });

  it("keeps a photo attached to a chore assignment after the candidate read", async () => {
    const attached = seedUpload();
    const { client } = racingDb(() => {
      db.rows("choreAssignment").push({
        id: "asg-race", family_id: FAMILY_A, chore_id: "chore-a", assigned_to: "child-a",
        photo_url: `/api/files/chores/${attached.filename}`,
      });
    });

    const { count } = await prune(client);

    expect(count).toBe(0);
    expect(ids()).toContain(attached.id);
  });

  it("another household's reference to the same filename does not keep the row", async () => {
    const stale = seedUpload();
    const { client } = racingDb(() => {
      db.rows("chore").find((c: any) => c.id === "chore-b")!.photo_url = `/api/files/chores/${stale.filename}`;
    });

    const { count } = await prune(client);

    expect(count).toBe(1);
    expect(ids()).not.toContain(stale.id);
  });

  it("removes nothing when the household was deleted before the lock", async () => {
    seedUpload();
    const { client, steps } = racingDb(() => {
      db.tables.family = db.rows("family").filter((f: any) => f.id !== FAMILY_A);
    });

    const { count, removedFiles } = await prune(client);

    expect(count).toBe(0);
    expect(removedFiles).toEqual([]);
    expect(steps).not.toContain("delete");
  });
});


it('keeps a list cover attached after the cleanup candidate read', async () => {
  db.reset()
  const upload = seedUpload()
  const {client} = racingDb(() => db.rows('list').push({id:'cover',family_id:FAMILY_A,image_url:`/api/files/chores/${upload.filename}`}))
  const removed = await pruneUnreferencedUploads(client,FAMILY_A,{uploadDir:UPLOAD_DIR,removeFile:jest.fn()})
  expect(removed).toBe(0)
  expect(db.rows('upload').some(u => u.id === upload.id)).toBe(true)
})
