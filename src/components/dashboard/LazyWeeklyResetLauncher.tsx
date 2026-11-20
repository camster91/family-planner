"use client";

import dynamic from "next/dynamic";

/**
 * The server readiness/role gate in the Today page decides whether the weekly
 * reset launcher renders. A `next/dynamic` call in that server page cannot
 * split a client component, so the split lives on this client boundary: the
 * launcher (and its date helpers) loads only when the gate renders it, and a
 * dormant launcher stays out of Today's cold JavaScript.
 */
const LazyWeeklyResetLauncher = dynamic(() => import("./WeeklyResetLauncher"));

export default LazyWeeklyResetLauncher;
