import { NextRequest } from "next/server";
import { familyNameHttp } from "@/lib/family-name-http";
export const dynamic = "force-dynamic";
/** Dedicated contract: old servers cannot silently ignore the name precondition. */
export const PATCH = (request: NextRequest) => familyNameHttp(request, true);
