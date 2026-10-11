import { AllowanceCreateSheet } from "@/components/layout/AllowanceFormSheets";
import { FeatureGate } from "@/components/ui/feature-gate";
import { getServerUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;

  return (
    <FeatureGate featureKey="allowance">
      <AllowanceCreateSheet canCreate={sessionUser.role === "parent"} />
    </FeatureGate>
  );
}
