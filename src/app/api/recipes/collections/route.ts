import { NextRequest } from "next/server";
import { recipeCurationHttp } from "@/lib/recipe-curation-http";
export const dynamic = "force-dynamic";
export const GET = (request: NextRequest) => recipeCurationHttp(request);
export const POST = (request: NextRequest) => recipeCurationHttp(request);
