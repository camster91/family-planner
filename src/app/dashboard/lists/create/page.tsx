import CreateListForm from "./CreateListForm";
import { getServerUser } from "@/lib/supabase/server";
import { canCreateList } from "@/lib/role-capabilities";
import { listTypeFilter } from "@/lib/list-type-filter";
import { readDefaultNewListType } from "./default-type";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string | string[] }>;
}) {
  const sessionUser = await getServerUser();
  if (!sessionUser) return null;

  const initialType = listTypeFilter((await searchParams)?.type);
  return (
    <CreateListForm
      canCreate={canCreateList(sessionUser.role)}
      initialType={initialType}
      defaultType={initialType ? undefined : await readDefaultNewListType()}
    />
  );
}
