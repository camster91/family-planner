import { POST as createChore } from "@/app/api/chores/create/route";
import { NextResponse, type NextRequest } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { guardReviewDocumentSubmission } from "@/lib/review-document-submit-server";
import {
  REVIEW_SUBMIT_HEADERS as H,
  type ReviewSubmitAction,
} from "@/lib/review-document-submit-contract";
import { POST as createRecipe } from "@/app/api/recipes/route";
import { POST as createEvent } from "@/app/api/events/route";
import { POST as addGrocery } from "@/app/api/capture/grocery/route";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
export const dynamic = "force-dynamic";
/** Compatibility boundary, not a second effect path. Do not parse/change the
 * original request body. Every effect still runs its canonical handler/service.
 */
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    const action = request.headers.get(H.action);
    if (
      action !== "recipe.create" &&
      action !== "event.create" &&
      action !== "capture.grocery.add" &&
      action !== "chore.create" &&
      action !== "chore.profile.create"
    )
      return NextResponse.json(
        { error: { code: "INVALID_REVIEW_SUBMISSION" } },
        {
          status: 400,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    const refusal = guardReviewDocumentSubmission(
      request,
      auth,
      action as ReviewSubmitAction,
      true,
    );
    if (refusal) return refusal;
    const result = await (action === "chore.create" ||
    action === "chore.profile.create"
      ? createChore(request)
      : action === "recipe.create"
        ? createRecipe(request)
        : action === "event.create"
          ? createEvent(request)
          : addGrocery(request));
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  } catch (error) {
    logRouteError(
      "POST review document submission",
      error,
      getRequestId(request),
    );
    return NextResponse.json(
      { error: { code: "REVIEW_SUBMISSION_UNAVAILABLE" } },
      {
        status: 500,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
