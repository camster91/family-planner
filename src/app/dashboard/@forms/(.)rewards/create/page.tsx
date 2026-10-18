import { getServerUser } from "@/lib/supabase/server";
import { RewardCreateSheet } from "@/components/rewards/RewardCreateSheet";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;
  return (
    <RewardCreateSheet
      canCreate={sessionUser.role === "parent"}
      owner={sessionUser.family_id ? { userId: sessionUser.id, familyId: sessionUser.family_id } : undefined}
    />
  );
}
