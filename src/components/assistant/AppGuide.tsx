"use client";
import * as React from "react";
import Link from "next/link";
import { SearchField } from "@/components/ui/search-field";
import { useFeatures } from "@/components/providers/features-provider";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { canRoleAccessPath } from "@/lib/kid-access";
import { APP_HELP_TOPICS } from "@/lib/app-help-topics";
import { useHelpText } from "@/i18n/help";
import { useDraftAwareRouter } from "@/components/layout/owned-draft-navigation";

/** Local documentation lookup: no model request, household context or write tool. */
export default function AppGuide({
  role,
  disabled,
  canNavigate,
  onNavigated,
}: {
  role: string;
  disabled: boolean;
  canNavigate: () => boolean;
  onNavigated?: () => void;
}) {
  const router = useDraftAwareRouter();
  const [query, setQuery] = React.useState("");
  const { features } = useFeatures();
  const text = useHelpText();
  const q = query.normalize("NFC").trim().toLocaleLowerCase();
  const topics = APP_HELP_TOPICS.filter(
    (topic) =>
      (!topic.feature || isFeatureEnabled(features, topic.feature)) &&
      (!topic.href.startsWith("/dashboard") ||
        (["parent", "teen", "child"].includes(role) &&
          canRoleAccessPath(role, topic.href.split(/[?#]/)[0]))) &&
      (!q ||
        [text(topic.title), text(topic.answer)].some((value) =>
          value.toLocaleLowerCase().includes(q),
        )),
  );
  return (
    <details
      data-app-guide
      className="rounded-2xl border border-[var(--surface-separator)] p-3"
    >
      <summary className="min-h-[44px] cursor-pointer content-center text-body font-semibold">
        {text("guideTitle")}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-footnote text-label-secondary">
          {text("guideDescription")}
        </p>
        <SearchField
          value={query}
          onChange={setQuery}
          ariaLabel={text("guideSearch")}
          placeholder={text("guidePlaceholder")}
          clearLabel={text("guideClear")}
        />
        {topics.map((topic) => (
          <details
            key={topic.id}
            className="rounded-xl bg-[var(--surface-fill)] p-3"
          >
            <summary className="min-h-[44px] cursor-pointer content-center text-subhead font-semibold">
              {text(topic.title)}
            </summary>
            <p className="mt-2 text-subhead text-label-secondary">
              {text(topic.answer)}
            </p>
            <Link
              href={topic.href}
              aria-disabled={disabled}
              tabIndex={disabled ? -1 : undefined}
              onClick={(event) => {
                if (disabled || !canNavigate()) {
                  event.preventDefault();
                  return;
                }
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                void router.push(topic.href).then((navigated) => {
                  if (navigated) onNavigated?.();
                });
              }}
              className="mt-2 inline-flex min-h-[44px] items-center text-subhead font-semibold text-[var(--accent-text)]"
            >
              {text(topic.title)} →
            </Link>
          </details>
        ))}
        {!topics.length && (
          <p role="status" className="text-subhead text-label-secondary">
            {text("guideEmpty")}
          </p>
        )}
      </div>
    </details>
  );
}
