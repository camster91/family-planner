import CreateListForm from "./CreateListForm";
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
  if (!sessionUser) return null;

  return (
    <CreateListForm
      canCreate={canCreateList(sessionUser.role)}
      initialType={listTypeFilter((await searchParams)?.type)}
    />
  );
}
