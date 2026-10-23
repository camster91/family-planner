import { NextRequest } from "next/server";
import { recipeCurationHttp } from "@/lib/recipe-curation-http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: NextRequest, context: Context) =>
  recipeCurationHttp(request, (await context.params).id);
export const PATCH = async (request: NextRequest, context: Context) =>
  recipeCurationHttp(request, (await context.params).id);
