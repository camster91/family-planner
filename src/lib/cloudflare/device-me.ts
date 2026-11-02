/** Household-only, name-only shared surface. A fresh device generation is
 * admitted with the entire projection before any metadata is returned. */
import { normalizeFeatures } from "@/lib/features";
import { elevationState, type DeviceActor } from "@/lib/device-session";
import { getD1Database, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { isD1WriteConflict } from "./write-check";
import { readD1DeviceActor } from "./device-sessions";
export async function readD1DeviceMe(
  actor: DeviceActor,
  now: Date,
  database?: D1Store,
) {
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 8; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        const access = await readD1DeviceActor(db, actor, now);
        if (!access.ok) return { status: access.status, code: access.code };
        const [family, parents] = await Promise.all([
          db.family.findUnique({
            where: { id: actor.familyId },
            select: { name: true, features: true, device_writes_enabled: true },
          }),
          db.user.findMany({
            where: { family_id: actor.familyId, role: "parent" },
            select: { id: true, name: true },
            orderBy: [{ created_at: "asc" }, { id: "asc" }],
          }),
        ]);
        if (!family)
          return { status: 401, code: "DEVICE_SESSION_INVALID" as const };
        const pins = parents.length
          ? await db.parentElevationPin.findMany({
              where: {
                family_id: actor.familyId,
              },
              select: { user_id: true },
            })
          : [];
        const flags = normalizeFeatures(family.features),
          withPin = new Set(pins.map((p) => p.user_id));
        return {
          status: 200,
          body: {
            device: { id: access.device.id, label: access.device.label },
            household: { name: family.name },
            features: {
              calendar: flags.calendar,
              chores: flags.chores,
              meals: flags.meals,
              lists: flags.lists,
            },
            parents: parents.map((p) => ({
              id: p.id,
              name: p.name,
              hasPin: withPin.has(p.id),
            })),
            deviceWrites: Boolean(family.device_writes_enabled),
            elevation: elevationState(access.device, now),
          },
        };
      },
      store as unknown as NativeD1,
    );
    try {
      await session.batch(captured.checks(session));
      return captured.value;
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return { status: 503, code: "SERVICE_UNAVAILABLE" as const, body: undefined };
}
