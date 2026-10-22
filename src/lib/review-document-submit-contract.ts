/** Foreground submission metadata. Original canonical body/key stay unchanged. */
export const REVIEW_SUBMIT_HEADERS = {
  contract: "X-Review-Document-Contract",
  owner: "X-Review-Document-Owner",
  action: "X-Review-Document-Action",
  expires: "X-Review-Document-Expires",
} as const;
export type ReviewSubmitAction =
  "recipe.create" | "event.create" | "capture.grocery.add";
export function reviewSubmitDomain(action: ReviewSubmitAction) {
  return action === "recipe.create"
    ? ("recipe" as const)
    : ("capture" as const);
}
