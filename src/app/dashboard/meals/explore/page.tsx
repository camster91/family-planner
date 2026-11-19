import { reviewDocumentRecoveryAdopted } from "@/lib/review-document-owner";
import RecipeExplorePage from "./ExploreClient";

export const dynamic = "force-dynamic";

/**
 * Meals › Explore. The page itself is a client component; this server entry
 * only reads whether saved recipe work (meals review) is switched on, so the
 * "Continue saved recipe work" link shows only when that page can open.
 */
export default function Page() {
  return <RecipeExplorePage savedWorkEnabled={reviewDocumentRecoveryAdopted()} />;
}
