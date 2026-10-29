import type { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";
import { storageBackend } from "./storage-backend";
import { withD1ReadClient, type NativeD1 } from "./cloudflare/read-client";
import { hydrateD1ChoreProfileMembers } from "./cloudflare/chore-read-policy";
import { getD1Database, type D1Store } from "./cloudflare/database";
/** Only operations used by canonical chore list/detail/server rendering. */
export type ChoreReadDb = {
  chore: Pick<PrismaClient["chore"], "findFirst" | "findMany">;
  user: Pick<PrismaClient["user"], "findUnique" | "findMany">;
};
function validateRows(value: unknown): unknown {
  if (Array.isArray(value)) {
    value.forEach(validateRows);
    return value;
  }
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (
      "weekly_days" in row &&
      (!Array.isArray(row.weekly_days) ||
        !row.weekly_days.every(
          (v) => typeof v === "number" && Number.isInteger(v),
        ))
    )
      throw new Error("Invalid stored chore weekdays");
    if (
      "rotation_member_ids" in row &&
      (!Array.isArray(row.rotation_member_ids) ||
        !row.rotation_member_ids.every((v) => typeof v === "string"))
    )
      throw new Error("Invalid stored chore rotation");
  }
  return value;
}
type BaseRow = {
  family_id: string;
  assigned_to: string | null;
  created_by: string;
  assigned_member_id: string | null;
};
type Person = {
  id: string;
  name: string;
  avatar_url: string | null;
  family_id: string | null;
};
function selectedPerson(row: Person | undefined, include: unknown) {
  if (!row) return null;
  const select = (include as { select?: Record<string, unknown> })?.select;
  if (!select)
    throw new Error("Chore relation requires an explicit public selection");
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(select)) {
    if (
      !["id", "name", "avatar_url", "family_id"].includes(key) ||
      select[key] !== true
    )
      throw new Error("Chore person projection refused");
    output[key] = row[key as keyof Person];
  }
  return output;
}
export async function withChoreReads<T>(
  read: (db: ChoreReadDb) => Promise<T>,
  database?: NativeD1,
): Promise<T> {
  if (storageBackend() !== "d1") return read(prisma!);
  const store =
    (database as unknown as D1Store | undefined) ?? (await getD1Database());
  return withD1ReadClient(
    (db) => {
      // Nested composite relations can exceed SQLite's parameter limit and make
      // Prisma start an implicit transaction. Read scalar occurrences first and
      // explicitly hydrate the source-owned public relations in scoped batches.
      // No transaction guard is disabled or emulated; no write method is exposed.
      async function query(
        operation: "findFirst" | "findMany",
        args: unknown[],
      ) {
        const input = args[0] as {
            include?: Record<string, unknown>;
            select?: unknown;
          },
          include = input?.include;
        const { include: _include, ...scalars } = input ?? {};
        const result = validateRows(
          await Reflect.apply(db.chore[operation], db.chore, [scalars]),
        );
        if (!include) return result;
        if (input.select)
          throw new Error("Chore projection cannot combine select and include");
        const rows = (
          Array.isArray(result) ? result : result ? [result] : []
        ) as BaseRow[];
        if (
          Object.keys(include).some(
            (key) => !["assignee", "creator", "assigneeMember"].includes(key),
          )
        )
          throw new Error("Chore relation projection refused");
        const byFamily = new Map<string, BaseRow[]>();
        for (const row of rows) {
          const group = byFamily.get(row.family_id) ?? [];
          group.push(row);
          byFamily.set(row.family_id, group);
        }
        const people = new Map<string, Person>(),
          profiles = new Map<string, unknown>();
        for (const [familyId, group] of byFamily) {
          const ids = [
            ...new Set(
              group.flatMap((row) => [
                ...(include.assignee && row.assigned_to
                  ? [row.assigned_to]
                  : []),
                ...(include.creator ? [row.created_by] : []),
              ]),
            ),
          ];
          for (let offset = 0; offset < ids.length; offset += 50) {
            const found = await db.user.findMany({
              where: {
                family_id: familyId,
                id: { in: ids.slice(offset, offset + 50) },
              },
              select: {
                id: true,
                name: true,
                avatar_url: true,
                family_id: true,
              },
            });
            for (const person of found)
              if (person.family_id === familyId)
                people.set(`${familyId}:${person.id}`, person);
          }
          if (include.assigneeMember)
            for (const row of await hydrateD1ChoreProfileMembers(
              familyId,
              group,
              store,
            ))
              if (row.assigned_member_id)
                profiles.set(
                  `${familyId}:${row.assigned_member_id}`,
                  row.assigneeMember,
                );
        }
        const projected = rows.map((row) => ({
          ...row,
          ...(include.assignee
            ? {
                assignee: selectedPerson(
                  people.get(`${row.family_id}:${row.assigned_to}`),
                  include.assignee,
                ),
              }
            : {}),
          ...(include.creator
            ? {
                creator: selectedPerson(
                  people.get(`${row.family_id}:${row.created_by}`),
                  include.creator,
                ),
              }
            : {}),
          ...(include.assigneeMember
            ? {
                assigneeMember: row.assigned_member_id
                  ? (profiles.get(
                      `${row.family_id}:${row.assigned_member_id}`,
                    ) ?? null)
                  : null,
              }
            : {}),
        }));
        return operation === "findMany" ? projected : (projected[0] ?? null);
      }
      const chore = {
        findFirst: (...args: unknown[]) => query("findFirst", args),
        findMany: (...args: unknown[]) => query("findMany", args),
      };
      // Scalar arrays are JSON in the generated SQLite type; actual arrays are
      // validated above. The compatibility type remains limited to read methods.
      return read({ chore, user: db.user } as unknown as ChoreReadDb);
    },
    store as unknown as NativeD1,
  );
}
