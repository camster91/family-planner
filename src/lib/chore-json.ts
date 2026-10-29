import { NextResponse } from "next/server";
import { publicChoreData } from "@/lib/chore-public-data";
/** Ordinary chore routes expose snapshots only, including parent edit responses. */
export function choreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  return NextResponse.json(publicChoreData(body), { ...init, headers });
}
