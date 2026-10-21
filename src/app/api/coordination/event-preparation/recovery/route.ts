import type { NextRequest } from "next/server";
import { handlePreparationHttp } from "@/lib/event-preparation/route";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) =>
  handlePreparationHttp(request, "context");
export const POST = (request: NextRequest) =>
  handlePreparationHttp(request, "inspect");
