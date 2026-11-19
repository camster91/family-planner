"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { useDashboardNotFoundText } from "@/i18n/dashboard-not-found";

/** Body of the in-app "not available" page; see ./not-found.tsx. */
export default function DashboardNotFoundContent() {
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
