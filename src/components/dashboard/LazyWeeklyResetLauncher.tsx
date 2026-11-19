"use client";

import dynamic from "next/dynamic";

/**
 * Client boundary for the optional Weekly reset launcher. A `dynamic()` import
 * written in the Today server page still lists the launcher among the page's
 * client references, so its code shipped with every cold Today board even
 * while the readiness gate keeps it off. Splitting here, behind a client
 * boundary, loads the launcher only when the page renders it.
 */
const LazyWeeklyResetLauncher = dynamic(() => import("./WeeklyResetLauncher"));

export default LazyWeeklyResetLauncher;
