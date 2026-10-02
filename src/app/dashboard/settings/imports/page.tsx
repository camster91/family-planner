import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase/server";
import { isParentRole } from "@/lib/role-capabilities";
import ImportsClient from "./ImportsClient";

export const metadata: Metadata = { title: "Import" };
export const dynamic = "force-dynamic";

/**
 * Data import from other apps. Parent only: teens and children are redirected
 * by the kid allowlist before they get here (src/lib/kid-access.ts), this page
 * checks the session role again, and the admin imports API refuses them.
 */
export default async function ImportsSettingsPage() {
  const user = await getServerUser();
  if (!user) redirect("/login?redirect=/dashboard/settings/imports");
  if (!isParentRole(user.role)) redirect("/dashboard");
  return <ImportsClient />;
}
