import { NextRequest } from "next/server";
import { createCallingSession } from "@/lib/calling/server";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  return createCallingSession(request);
}
