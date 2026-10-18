"use client";
import * as React from "react";
import DisplayPreferencesStatus from "@/components/account/DisplayPreferencesStatus";
import AppGuide from "@/components/assistant/AppGuide";
import { Sliders, Star } from "lucide-react";
import { LargeHeader } from "@/components/ui/large-header";
import { InsetList, ListRow } from "@/components/ui/list-row";
import { SearchField } from "@/components/ui/search-field";
import { useFeatures } from "@/components/providers/features-provider";
import { useDisplayPreferences } from "@/components/providers/display-preferences-provider";
import { moreItemsFor, type MoreItem } from "@/lib/nav-items";
import { FEATURES } from "@/lib/features";
import { MAX_FAVORITES } from "@/lib/personal-layout";
import { useFeatureDisplayCopy } from "@/i18n/feature-display";
import { useMoreText } from "@/i18n/more";
import { useFeaturesText, type FeaturesMessage } from "@/i18n/features";
import { usePersonalLayoutText } from "@/i18n/personal-layout";

const groups = ["core", "planning", "family"] as const;
const groupCopy: Record<
  (typeof groups)[number],
  { title: FeaturesMessage; subtitle: FeaturesMessage }
> = {
  core: { title: "coreTitle", subtitle: "coreSubtitle" },
  planning: { title: "planningTitle", subtitle: "planningSubtitle" },
  family: { title: "familyTitle", subtitle: "familySubtitle" },
};
/** One discovery surface; every item is intersected with current flags and role. */
export default function ExploreBrowser({
  role,
  inSheet = false,
  onNavigate,
}: {
  role: string;
  inSheet?: boolean;
  onNavigate?: () => void;
}) {
  const { features } = useFeatures();
  const { layout, saving, syncState, toggleFavorite } = useDisplayPreferences();
  const featureDisplay = useFeatureDisplayCopy();
  const settingsText = useFeaturesText();
  const more = useMoreText();
  const text = usePersonalLayoutText();
  const [query, setQuery] = React.useState("");
  const [atLimit, setAtLimit] = React.useState(false);
  const items = moreItemsFor(role, features, featureDisplay);
  const normalizedQuery = query.normalize("NFC").trim().toLocaleLowerCase();
  const filtered = items.filter(
    (item) =>
      !normalizedQuery ||
      [item.title, item.description].some((value) =>
        value.toLocaleLowerCase().includes(normalizedQuery),
      ),
  );
  const visibleFavoriteKeys = layout.favorites.filter((key) =>
    items.some((item) => item.key === key),
  );
  const pinned = visibleFavoriteKeys
    .map((key) => filtered.find((item) => item.key === key))
    .filter((item): item is MoreItem => Boolean(item));
  const unpinned = filtered.filter(
    (item) => !visibleFavoriteKeys.includes(item.key),
  );
  const row = (item: MoreItem, index: number, rows: MoreItem[]) => {
    const favorite = layout.favorites.includes(item.key);
    return (
      <li key={item.key} className="flex min-w-0 items-center">
        <div className="min-w-0 flex-1">
          <ListRow
            icon={item.icon}
            glyphColor="plain"
            title={item.title}
            subtitle={item.description}
            href={item.href}
            last={index === rows.length - 1}
          />
        </div>
        <button
          type="button"
          disabled={saving || syncState !== "ready"}
          aria-pressed={favorite}
          aria-label={text(favorite ? "unpin" : "pin", { feature: item.title })}
          className="min-h-[44px] min-w-[44px] shrink-0 rounded-xl text-[var(--accent-text)] focus-visible:outline"
          onClick={() => {
            if (!favorite && visibleFavoriteKeys.length >= MAX_FAVORITES) {
              setAtLimit(true);
              return;
            }
            setAtLimit(false);
            void toggleFavorite(
              item.key,
              items.map((entry) => entry.key),
            );
          }}
        >
          <Star
            className={`mx-auto h-5 w-5 ${favorite ? "fill-current" : ""}`}
            aria-hidden="true"
          />
        </button>
      </li>
    );
  };
  return (
    <div
      className={inSheet ? "space-y-4" : "space-y-5 pb-20"}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a[href]")) onNavigate?.();
      }}
    >
      {!inSheet && (
        <LargeHeader title={more("title")} subtitle={text("favoriteHelp")} />
      )}
      <div role="search" aria-label={more("searchLabel")}>
        <SearchField
          ariaLabel={more("searchLabel")}
          value={query}
          onChange={setQuery}
          placeholder={more("searchPlaceholder")}
          clearLabel={more("clearSearch")}
        />
      </div>
      {atLimit && (
        <p role="status" className="text-footnote text-label-secondary">
          {text("limit")}
        </p>
      )}
      <DisplayPreferencesStatus />
      {pinned.length > 0 && (
        <section aria-labelledby="explore-favorites">
          <h2 id="explore-favorites" className="section-header">
            {text("favorites")}
          </h2>
          <InsetList>
            <ul>{pinned.map(row)}</ul>
          </InsetList>
        </section>
      )}
      <div
        className={
          inSheet
            ? "space-y-5"
            : "grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3"
        }
        data-testid="more-list"
      >
        {groups.map((group) => {
          const rows = unpinned.filter(
            (item) =>
              (FEATURES.find((feature) => feature.key === item.key)?.group ??
                "family") === group,
          );
          if (!rows.length) return null;
          return (
            <section
              key={group}
              className="min-w-0"
              aria-labelledby={`more-group-${group}`}
            >
              <h2 id={`more-group-${group}`} className="section-header">
                {settingsText(groupCopy[group].title)}
              </h2>
              <p className="pb-2 text-footnote text-label-secondary">
                {settingsText(groupCopy[group].subtitle)}
              </p>
              <InsetList>
                <ul>{rows.map(row)}</ul>
              </InsetList>
            </section>
          );
        })}
      </div>
      <AppGuide role={role} />
      {!filtered.length && (
        <div role="status" className="card-apple space-y-3 p-5">
          <p>{more("noMatches")}</p>
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => setQuery("")}
          >
            {more("clearFilters")}
          </button>
        </div>
      )}
      {role === "parent" && (
        <InsetList>
          <ListRow
            icon={Sliders}
            glyphColor="plain"
            title={more("settingsTitle")}
            subtitle={more("settingsDescription")}
            href="/dashboard/features"
            last
          />
        </InsetList>
      )}
    </div>
  );
}
