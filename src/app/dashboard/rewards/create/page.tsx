import { FeatureGate } from "@/components/ui/feature-gate";
import { getServerUser } from "@/lib/supabase/server";
import CreateRewardForm from "./CreateRewardForm";

export const dynamic = "force-dynamic";

export default async function CreateRewardPage() {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;

  return (
    <FeatureGate featureKey="rewards">
      <CreateRewardForm canCreate={sessionUser.role === "parent"} />
    </FeatureGate>
  );
}
