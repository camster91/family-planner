"use client";

import dynamic from "next/dynamic";

// Today's optional, conditional parts. A Server Component cannot code-split a
// Client Component it imports (even through next/dynamic), so these client
// wrappers do it: households past setup, or without a ready weekly review,
// never download that code on a cold Today load (#413 budget). When the page
// renders them they still render on the server and their chunk is preloaded.
export const TodaySetup = dynamic(() => import("./TodaySetup"));
export const WeeklyResetLauncher = dynamic(
  () => import("./WeeklyResetLauncher"),
);
