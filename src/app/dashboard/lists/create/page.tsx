import CreateListForm from "./CreateListForm";
import { getServerUser } from "@/lib/supabase/server";
import { canCreateList } from "@/lib/role-capabilities";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;

  return <CreateListForm canCreate={canCreateList(sessionUser.role)} />;
}
