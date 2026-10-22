"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "@/i18n";
import { listsPageHref, type ListTypeKey } from "@/lib/list-type-filter";

/** Canonical filtered destination also works for direct links and missing lists. */
export default function ListsBackLink({
  filter,
  cursor,
}: {
  filter: ListTypeKey | null;
  cursor?: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Link
      href={listsPageHref(filter, cursor)}
      className="inline-flex min-h-[44px] items-center gap-1 text-subhead text-[var(--accent)] rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      <span>{t("listOverview.title")}</span>
    </Link>
  );
}
