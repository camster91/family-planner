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
  ASSISTANT_TARGET_PROOF_HEADER,
} from "@/lib/assistant-reference-contract";
import {
  readAssistantSourceProof,
  AssistantSourceRefused,
} from "@/lib/assistant-source-proof";
import { DELETE as deleteEvent } from "@/app/api/events/route";
import { DELETE as deleteChore } from "@/app/api/chores/route";
import { DELETE as deleteList } from "@/app/api/lists/route";
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
    targetProof: z.string().min(1).max(4096).optional(),
  })
  .strict();
const routes = {
  event_delete: { path: "/api/events", handler: deleteEvent, method: "DELETE" },
  chore_delete: { path: "/api/chores", handler: deleteChore, method: "DELETE" },
  list_delete: { path: "/api/lists", handler: deleteList, method: "DELETE" },
  event_create: { path: "/api/events", handler: createEvent, method: "POST" },
  chore_create: {
    path: "/api/chores/create",
    handler: createChore,
    method: "POST",
  },
  list_create: {
    path: "/api/lists/create",
    handler: createList,
    method: "POST",
  },
  note_create: { path: "/api/notes", handler: createNote, method: "POST" },
  grocery_add: {
    path: "/api/lists/items/create",
    handler: addGrocery,
    method: "POST",
  },
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
    // No legacy unchecked fallback for unrecognized/future domains.
    if (!(command.kind in routes)) throw new AssistantSourceRefused();
    const route = routes[command.kind as keyof typeof routes];
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    headers.set("Content-Type", "application/json");
    headers.delete(ASSISTANT_TARGET_PROOF_HEADER);
    if (command.kind.endsWith("_delete") && !command.targetProof)
      throw new AssistantSourceRefused();
    if (command.targetProof)
      headers.set(ASSISTANT_TARGET_PROOF_HEADER, command.targetProof);
    headers.set(ASSISTANT_SOURCE_PROOF_HEADER, command.sourceProof);
    const canonical = new NextRequest(new URL(route.path, request.url), {
      method: route.method,
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
