import CreateChoreForm from "./CreateChoreForm";
import { getServerActor } from "@/lib/supabase/server";

export default async function Page() {
  const actor = await getServerActor();
  return <CreateChoreForm contextIdentity={actor?.role === "parent" && actor.family_id ? { userId: actor.id, familyId: actor.family_id } : undefined} />;
}
