import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import { readD1HouseholdPeople } from "@/lib/cloudflare/event-participants";
import { readHouseholdPeople } from "@/lib/event-participants-db";
import { eventPeopleReady } from "@/lib/event-participants";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";

/**
 * GET - the people an event in this household can be for: accounts and
 * standalone email-free profiles, in household order, with the colour each
 * has everywhere else. Identity, name and colour only.
 *
 * `supported: false` (capability off) is an explicit answer, not an empty
 * household: clients hide the picker and never send a people list.
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const headers = { "Cache-Control": "private, no-store" };
    if (!eventPeopleReady()) return NextResponse.json({ supported: false, people: [] }, { headers });
    const familyId = auth.user.family_id;
    const people = storageBackend() === "d1"
      ? await readD1HouseholdPeople((await getD1Database()).withSession("first-primary"), familyId)
      : await readHouseholdPeople(prisma!, familyId);
    return NextResponse.json({ supported: true, people: [...people.values()] }, { headers });
  } catch (error) {
    logRouteError("GET /api/events/people", error, getRequestId(request));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
