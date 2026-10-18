import { ListCreateSheet } from "@/components/layout/DashboardFormSheets";
import { getServerUser } from "@/lib/supabase/server";
import { canCreateList } from "@/lib/role-capabilities";
import { listTypeFilter } from "@/lib/list-type-filter";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string | string[] }>;
}) {
  const sessionUser = await getServerUser();
  return (
    <ListCreateSheet
      initialType={listTypeFilter((await searchParams)?.type)}
      canCreate={Boolean(sessionUser && canCreateList(sessionUser.role))}
    />
  );
}
