import { ListCreateSheet } from "@/components/layout/DashboardFormSheets";
import { getServerUser } from "@/lib/supabase/server";
import { canCreateList } from "@/lib/role-capabilities";

export const dynamic = "force-dynamic";

export default async function Page() {
  const sessionUser = await getServerUser();
  return (
    <ListCreateSheet
      canCreate={Boolean(sessionUser && canCreateList(sessionUser.role))}
    />
  );
}
