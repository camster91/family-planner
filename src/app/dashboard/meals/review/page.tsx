import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { RecipeRecoveryHost } from "@/components/meals/RecipeRecoveryHost";
export const dynamic = "force-dynamic";

/** Personal local-work recovery remains reachable during a meal write pause.
 * The editor/context/receipt/canonical APIs still enforce their own live gates.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getServerUser();
  if (!user) return null;
  if (!user.family_id || (user.role !== "parent" && user.role !== "teen"))
    redirect("/dashboard");
  const params = await searchParams;
  if (
    params.mode === "fridge" ||
    (Array.isArray(params.mode) && params.mode.includes("fridge"))
  )
    redirect("/dashboard/today?mode=fridge");
  return (
    <RecipeRecoveryHost
      identity={{ userId: user.id, familyId: user.family_id }}
    />
  );
}
