"use client";

import dynamic from "next/dynamic";

/**
 * In-app "not available" page for /dashboard. A page that calls notFound()
 * (for example a feature switched off by a server flag, such as
 * /dashboard/chores/schedules or /dashboard/budget/imported) renders this
 * inside the dashboard layout, so the top bar and tabs stay put instead of a
 * bare 404.
 *
 * The dashboard layout's not-found file ships with every dashboard page's
 * initial JavaScript, so the body (empty state, illustration, copy) loads
 * only when this page is actually shown. The server still renders it in full.
 */
const DashboardNotFoundContent = dynamic(() => import("./NotFoundContent"));

export default function DashboardNotFound() {
  return <DashboardNotFoundContent />;
}
