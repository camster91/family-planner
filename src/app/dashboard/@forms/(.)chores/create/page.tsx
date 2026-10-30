import { ChoreCreateSheet } from '@/components/layout/DashboardFormSheets'
import { getServerActor } from "@/lib/supabase/server";

export default async function Page() {
  const actor = await getServerActor();
  return <ChoreCreateSheet contextIdentity={actor?.role === "parent" && actor.family_id ? { userId: actor.id, familyId: actor.family_id } : undefined} />;
}
