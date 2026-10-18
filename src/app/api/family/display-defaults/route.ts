import type { NextRequest } from "next/server";
import { displayPreferencesRequest } from "@/lib/display-preferences-http";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) =>
  displayPreferencesRequest(request, "household", false);
export const PATCH = (request: NextRequest) =>
  displayPreferencesRequest(request, "household", true);
