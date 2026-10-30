import { NextRequest } from "next/server";
import { createCallingSession } from "@/lib/calling/server";
import { killSwitch } from "@/lib/device-http";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const off = killSwitch();
  if (off) return off;
  return createCallingSession(request, true);
}
