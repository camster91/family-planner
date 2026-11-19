"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useDashboardNotFoundText } from "@/i18n/dashboard-not-found";

/**
 * In-app "not available" page for /dashboard. A page that calls notFound()
 * (for example a feature switched off by a server flag, such as
 * /dashboard/chores/schedules or /dashboard/budget/imported) renders this
 * inside the dashboard layout, so the top bar and tabs stay put instead of a
 * bare 404.
 */
export default function DashboardNotFound() {
  const text = useDashboardNotFoundText();
  return (
    <div className="mx-auto max-w-xl py-8" data-testid="dashboard-not-found">
      <EmptyState
        icon={Compass}
        headingLevel="h1"
        title={text("title")}
        description={text("description")}
        action={
          <Link
            href="/dashboard"
            className="btn-tinted inline-flex min-h-[44px] items-center px-5 py-2 text-base font-medium"
          >
            {text("home")}
          </Link>
        }
      />
    </div>
  );
}
