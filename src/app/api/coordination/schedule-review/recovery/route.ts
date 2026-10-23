import type { NextRequest } from "next/server";
import { handleScheduleHttp } from "@/lib/calendar-planning/schedule-route";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) =>
  handleScheduleHttp(request, "context");
export const POST = (request: NextRequest) =>
  handleScheduleHttp(request, "inspect");
