import type { NextRequest } from "next/server";
import { handlePreparationHttp } from "@/lib/event-preparation/route";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) =>
  handlePreparationHttp(request, "read");
export const PATCH = (request: NextRequest) =>
  handlePreparationHttp(request, "write");
