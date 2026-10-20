import { NextResponse } from "next/server";
import { publicChoreData } from "@/lib/chore-public-data";
/** Ordinary chore routes expose snapshots only, including parent edit responses. */
export function choreJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(publicChoreData(body), init);
}
