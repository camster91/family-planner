/** Fixed in-process delegation to canonical handlers, never an HTTP tool/proxy.
 * Versioned endpoint prevents old replicas from ignoring a freshness header. */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { readIdempotencyKey } from "@/lib/idempotency";
import {
  assistantConfirmationKind,
  ASSISTANT_SOURCE_PROOF_HEADER,
} from "@/lib/assistant-reference-contract";
import {
  readAssistantSourceProof,
  AssistantSourceRefused,
} from "@/lib/assistant-source-proof";
import { POST as createEvent } from "@/app/api/events/route";
import { POST as createChore } from "@/app/api/chores/create/route";
import { POST as addGrocery } from "@/app/api/lists/items/create/route";
import { POST as createList } from "@/app/api/lists/create/route";
import { POST as createNote } from "@/app/api/notes/route";
export const dynamic = "force-dynamic";
const input = z
  .object({
    kind: assistantConfirmationKind,
    sourceProof: z.string().min(1).max(4096),
    body: z.record(z.unknown()),
  })
  .strict();
const routes = {
  event_create: { path: "/api/events", handler: createEvent },
  chore_create: { path: "/api/chores/create", handler: createChore },
  list_create: { path: "/api/lists/create", handler: createList },
  note_create: { path: "/api/notes", handler: createNote },
  grocery_add: { path: "/api/lists/items/create", handler: addGrocery },
} as const;
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) throw new AssistantSourceRefused();
    let command: z.infer<typeof input>;
    try {
      command = input.parse(
        JSON.parse(await boundedRequestText(request, 64000)),
      );
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid confirmation" },
        {
          status: error instanceof RequestBodyTooLarge ? 413 : 400,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    }
    readAssistantSourceProof(
      command.sourceProof,
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload?.tv ?? 0,
      },
      command.kind,
    );
    // Remaining domains must register canonical transactional guards before
    // this rollout gate can be activated. No legacy unchecked fallback.
    if (!(command.kind in routes)) throw new AssistantSourceRefused();
    const route = routes[command.kind as keyof typeof routes];
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.set("Content-Type", "application/json");
    headers.set(ASSISTANT_SOURCE_PROOF_HEADER, command.sourceProof);
    const canonical = new NextRequest(new URL(route.path, request.url), {
      method: "POST",
      headers,
      body: JSON.stringify(command.body),
    });
    const response = await route.handler(canonical);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AssistantSourceRefused) return error.response();
    // Delegated effect could have committed. Never label an unknown error as
    // a proven source refusal or automatically retry it.
    return NextResponse.json(
      { error: "Confirmation unavailable. Check the app before trying again." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
