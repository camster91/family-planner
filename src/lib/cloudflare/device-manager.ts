import type { D1ReadClient } from "./read-client";
export type DeviceManagerActor = {
  userId: string;
  familyId: string;
  generation: number;
};
export class D1DeviceManagerRefused extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: "UNAUTHORIZED" | "PARENT_REQUIRED" | "FAMILY_REQUIRED",
  ) {
    super(code);
  }
}
/** The route's person guard is renewed inside every native read/write batch. */
export async function requireD1DeviceManager(
  db: D1ReadClient,
  actor: DeviceManagerActor,
) {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (!user || user.token_version !== actor.generation)
    throw new D1DeviceManagerRefused(401, "UNAUTHORIZED");
  if (user.role !== "parent")
    throw new D1DeviceManagerRefused(403, "PARENT_REQUIRED");
  if (
    user.family_id !== actor.familyId ||
    !(await db.family.findUnique({
      where: { id: actor.familyId },
      select: { id: true },
    }))
  )
    throw new D1DeviceManagerRefused(403, "FAMILY_REQUIRED");
}
