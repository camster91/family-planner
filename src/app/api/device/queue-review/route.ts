import { NextRequest } from "next/server";
import { reviewQueueHttp } from "@/lib/queue-review-http";
export const dynamic = "force-dynamic";
export const POST = (request: NextRequest) =>
  reviewQueueHttp(request, "device");
