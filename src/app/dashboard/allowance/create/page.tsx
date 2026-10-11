import AllowanceCreateForm from "./AllowanceCreateForm";
import { FeatureGate } from "@/components/ui/feature-gate";
import { getServerUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;

  return (
    <FeatureGate featureKey="allowance">
      <AllowanceCreateForm canCreate={sessionUser.role === "parent"} />
    </FeatureGate>
  );
}
