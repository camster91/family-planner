"use client";
import Link from "next/link";
import { useRoutineScheduleText } from "@/i18n/routine-schedule";
export function RoutineScheduleEntry() {
  const t = useRoutineScheduleText();
  return (
    <Link
      href="/dashboard/chores/schedules"
      className="btn-ghost inline-flex min-h-[44px] items-center"
    >
      {t("open")}
    </Link>
  );
}
