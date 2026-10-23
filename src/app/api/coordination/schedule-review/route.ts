import type { NextRequest } from "next/server";
import { handleScheduleHttp } from "@/lib/calendar-planning/schedule-route";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) =>
  handleScheduleHttp(request, "read");
export const PATCH = (request: NextRequest) =>
  handleScheduleHttp(request, "write");
