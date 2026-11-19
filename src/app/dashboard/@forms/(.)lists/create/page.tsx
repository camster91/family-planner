import { ListCreateSheet } from "@/components/layout/DashboardFormSheets";
import { getServerUser } from "@/lib/supabase/server";
import { canCreateList } from "@/lib/role-capabilities";
import { listTypeFilter } from "@/lib/list-type-filter";
import { readDefaultNewListType } from "@/app/dashboard/lists/create/default-type";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string | string[] }>;
}) {
  const sessionUser = await getServerUser();
  const initialType = listTypeFilter((await searchParams)?.type);
  return (
    <ListCreateSheet
      initialType={initialType}
      defaultType={
        sessionUser && !initialType ? await readDefaultNewListType() : undefined
      }
      canCreate={Boolean(sessionUser && canCreateList(sessionUser.role))}
    />
  );
}
