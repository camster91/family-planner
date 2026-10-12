import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";

/**
 * Keep the historical family-create URL as an entry point into the same
 * onboarding flow used by /dashboard. This prevents two POST /api/family
 * clients from drifting apart on Add Everyone, roles, and recovery.
 */
export default async function CreateFamilyPage() {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;
  if (sessionUser.family_id) redirect("/dashboard");

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <OnboardingFlow userId={sessionUser.id} />
    </div>
  );
}
