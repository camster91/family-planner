import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerActor } from "@/lib/supabase/server";
import { isParentRole } from "@/lib/role-capabilities";
import { IMPORT_OWNER_PROTOCOL } from "@/lib/imports/import-owner-contract";
import ImportsClient from "./ImportsClient";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

/**
 * Data import from other apps. Parent only: teens and children are redirected
 * by the kid allowlist before they get here (src/lib/kid-access.ts), this page
 * checks the session role again, and the admin imports API refuses them.
 */
export default async function ImportsSettingsPage() {
  const user = await getServerActor();
  if (!user) redirect("/login?redirect=/dashboard/settings/imports");
  if (!isParentRole(user.role)) redirect("/dashboard");
  if (!user.family_id) redirect("/dashboard");
  return <ImportsClient owner={{ protocol: IMPORT_OWNER_PROTOCOL, actorId: user.id, familyId: user.family_id, generation: user.tokenVersion }} />;
}
