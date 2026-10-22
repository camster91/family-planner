"use client";

import * as React from "react";
import { useTranslation } from "@/i18n";
import type { ListOverviewMessage } from "@/i18n/list-overview";
import {
  ShoppingCart,
  CheckSquare,
  UtensilsCrossed,
  Heart,
  ShoppingBag,
  List,
  LucideIcon,
} from "lucide-react";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { InsetList, ListRow, SectionHeader } from "@/components/ui/list-row";
import { EmptyState } from "@/components/ui/empty-state";
import { ILLUSTRATIONS } from "@/lib/brand-illustrations";
import { LargeHeader } from "@/components/ui/large-header";
import {
  listTypeFilter,
  listsFilterHref,
  type ListTypeKey,
} from "@/lib/list-type-filter";

// -----------------------------------------------------------------------
// Type config
// -----------------------------------------------------------------------

interface TypeConfig {
  nameKey: ListOverviewMessage;
  showingKey: ListOverviewMessage;
  headingKey: ListOverviewMessage;
  emptyKey: ListOverviewMessage;
  createFirstKey: ListOverviewMessage;
  color: "lists" | "rewards" | "meals" | "family";
}

const TYPE_CONFIG: Record<ListTypeKey, TypeConfig> = {
  grocery: {
    nameKey: "groceryName",
    showingKey: "groceryShowing",
    headingKey: "groceryHeading",
    emptyKey: "groceryEmpty",
    createFirstKey: "groceryCreateFirst",
    color: "lists",
  },
  todo: {
    nameKey: "todoName",
    showingKey: "todoShowing",
    headingKey: "todoHeading",
    emptyKey: "todoEmpty",
    createFirstKey: "todoCreateFirst",
    color: "rewards",
  },
  meal_plan: {
    nameKey: "meal_planName",
    showingKey: "meal_planShowing",
    headingKey: "meal_planHeading",
    emptyKey: "meal_planEmpty",
    createFirstKey: "meal_planCreateFirst",
    color: "meals",
  },
  wishlist: {
    nameKey: "wishlistName",
    showingKey: "wishlistShowing",
    headingKey: "wishlistHeading",
    emptyKey: "wishlistEmpty",
    createFirstKey: "wishlistCreateFirst",
    color: "family",
  },
  custom: {
    nameKey: "customName",
    showingKey: "customShowing",
    headingKey: "customHeading",
    emptyKey: "customEmpty",
    createFirstKey: "customCreateFirst",
    color: "lists",
  },
  shopping: {
    nameKey: "shoppingName",
    showingKey: "shoppingShowing",
    headingKey: "shoppingHeading",
    emptyKey: "shoppingEmpty",
    createFirstKey: "shoppingCreateFirst",
    color: "lists",
  },
};

const ICONS: Record<string, LucideIcon> = {
  grocery: ShoppingCart,
  todo: CheckSquare,
  meal_plan: UtensilsCrossed,
  wishlist: Heart,
  shopping: ShoppingBag,
  custom: List,
};

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

interface ListSummary {
  image_url?: string | null;
  id: string;
  name: string;
  type: string;
  creator: { name: string };
  checked_count: number;
  total_count: number;
}

interface ListsClientProps {
  lists: ListSummary[];
  familyName: string;
  /** D9 (#102): parents and teens may create lists; a child may not. */
  canCreate?: boolean;
  /** `?type=` from the URL (route inventory F-6): show only lists of this type. */
  initialType?: string | null;
  loadFailed?: boolean;
  /** Exact same-snapshot household counts, independent of the displayed page. */
  typeCounts?: Partial<Record<ListTypeKey, number>>;
  paging?: {
    continued: boolean;
    firstHref: string;
    nextHref: string | null;
    currentCursor?: string | null;
  };
}

function listDetailHref(
  id: string,
  type: ListTypeKey | null,
  cursor?: string | null,
) {
  const query = new URLSearchParams();
  if (type) query.set("type", type);
  if (cursor) query.set("overviewCursor", cursor);
  return `/dashboard/lists/${encodeURIComponent(id)}${query.toString() ? `?${query}` : ""}`;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function ListsClient({
  lists,
  familyName,
  canCreate = true,
  initialType = null,
  loadFailed = false,
  typeCounts,
  paging,
}: ListsClientProps) {
  const router = useRouter();
  const [retrying, startRetry] = React.useTransition();
  const { t, locale } = useTranslation();
  const text = (
    key: ListOverviewMessage,
    params?: Record<string, string | number>,
  ) => t(`listOverview.${key}`, params);
  const pluralRules = new Intl.PluralRules(locale);
  // The compact controls filter this page (route inventory F-6); the old
  // /dashboard/lists/type/[type] pages redirect here with `?type=`.
  const [typeFilter, setTypeFilter] = React.useState<ListTypeKey | null>(() =>
    listTypeFilter(initialType),
  );
  React.useEffect(() => {
    setTypeFilter(listTypeFilter(initialType));
  }, [initialType]);
  const applyFilter = (next: ListTypeKey | null) => {
    // Paged filters are server-owned: never show a new chip/empty state over
    // the previous filter's page while navigation is pending or refused.
    if (!paging) setTypeFilter(next);
    void router.replace(listsFilterHref(next), { scroll: false });
  };
  const activeType = paging ? listTypeFilter(initialType) : typeFilter;
  const shown = activeType ? lists.filter((l) => l.type === activeType) : lists;
  const filterCfg = activeType ? TYPE_CONFIG[activeType] : null;
  // ADR-0007 O-8: no new 'meal_plan' lists (existing ones stay readable).
  const createHref =
    activeType && activeType !== "meal_plan"
      ? `/dashboard/lists/create?type=${activeType}`
      : "/dashboard/lists/create";
  const canCreateHere = canCreate && activeType !== "meal_plan";

  // Main type filters. 'meal_plan' is no longer a list type people
  // create (ADR-0007 O-8; meals live in /dashboard/meals), so its filter shows
  // only while the household still has such lists, which keep opening as before.
  const hasMealPlanLists =
    (typeCounts?.meal_plan ??
      lists.filter((l) => l.type === "meal_plan").length) > 0;
  const mainTypes: ListTypeKey[] = hasMealPlanLists
    ? ["grocery", "todo", "meal_plan", "wishlist", "custom"]
    : ["grocery", "todo", "wishlist", "custom"];
  // Non-food shopping remains available when used, or when directly filtered.
  if (
    activeType === "shopping" ||
    (typeCounts?.shopping ??
      lists.filter((list) => list.type === "shopping").length) > 0
  ) {
    mainTypes.push("shopping");
  }

  return (
    <div className="pb-20">
      <LargeHeader
        greeting={familyName}
        title={text(activeType === "grocery" ? "groceryName" : "title")}
        trailing={
          canCreate &&
          !loadFailed &&
          (shown.length > 0 || activeType === "meal_plan") ? (
            // Same filled primary "+" as Chores and Calendar.
            <Link
              href={createHref}
              className="btn-filled shrink-0"
              aria-label={text("add")}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
            </Link>
          ) : undefined
        }
        className="px-4"
      />

      <div className="space-y-6 px-4">
        {loadFailed ? (
          <section role="alert" className="card-apple p-5 space-y-3">
            <h2 className="text-title-3 font-display text-label-primary">
              {text("loadFailed")}
            </h2>
            <p className="text-body text-label-secondary">
              {text("loadFailedHint")}
            </p>
            <button
              type="button"
              className="btn-filled min-h-[44px]"
              disabled={retrying}
              aria-busy={retrying}
              onClick={() => startRetry(() => router.refresh())}
            >
              {text(retrying ? "retrying" : "retry")}
            </button>
          </section>
        ) : (
          <>
            <section aria-label={text("filter")}>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-label={text("showAll")}
                  aria-pressed={activeType === null}
                  onClick={() => applyFilter(null)}
                  className={
                    "min-h-[44px] max-w-full [overflow-wrap:anywhere] rounded-full px-4 py-2 text-subhead font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] " +
                    (activeType === null
                      ? "bg-[var(--accent-tint)] text-label-primary ring-1 ring-[var(--accent)]"
                      : "bg-[var(--surface-fill)] text-label-secondary")
                  }
                >
                  {text("all")}
                </button>
                {mainTypes.map((type) => {
                  const cfg = TYPE_CONFIG[type];
                  const count =
                    typeCounts?.[type] ??
                    lists.filter((list) => list.type === type).length;
                  const pressed = activeType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={pressed}
                      onClick={() => applyFilter(pressed ? null : type)}
                      className={
                        "min-h-[44px] max-w-full [overflow-wrap:anywhere] rounded-full px-4 py-2 text-subhead font-medium flex flex-wrap items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] " +
                        (pressed
                          ? "bg-[var(--accent-tint)] text-label-primary ring-1 ring-[var(--accent)]"
                          : "bg-[var(--surface-fill)] text-label-secondary")
                      }
                    >
                      <span>{text(cfg.nameKey)}</span>
                      {count > 0 && (
                        <span className="text-caption-1">
                          {text(
                            pluralRules.select(count) === "one"
                              ? "countOne"
                              : "countOther",
                            { count },
                          )}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
            {filterCfg && (
              <p className="text-subhead text-label-secondary" role="status">
                {text(filterCfg.showingKey)}
              </p>
            )}
            {paging && (paging.continued || paging.nextHref) && (
              <p className="text-footnote text-label-secondary" role="status">
                {text("pagedHint")}
              </p>
            )}
            {shown.length > 0 ? (
              <section>
                <SectionHeader>
                  {text(filterCfg ? filterCfg.headingKey : "all")}
                </SectionHeader>
                <InsetList>
                  {shown.map((list, i) => {
                    const cfg =
                      TYPE_CONFIG[listTypeFilter(list.type) ?? "grocery"];
                    const Icon = ICONS[list.type] || ShoppingCart;
                    return (
                      <ListRow
                        key={list.id}
                        href={listDetailHref(
                          list.id,
                          activeType,
                          paging?.currentCursor,
                        )}
                        icon={Icon}
                        glyphColor={cfg.color}
                        title={list.name}
                        subtitle={list.creator.name}
                        trailing={
                          <span className="flex items-center gap-2">
                            {list.image_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={list.image_url}
                                alt=""
                                width={48}
                                height={48}
                                loading="lazy"
                                className="h-12 w-12 rounded-lg object-cover"
                              />
                            )}
                            {list.total_count > 0 ? (
                              <span className="text-footnote text-label-tertiary">
                                {list.checked_count}/{list.total_count}
                              </span>
                            ) : null}
                          </span>
                        }
                        last={i === shown.length - 1}
                      />
                    );
                  })}
                </InsetList>
              </section>
            ) : paging?.continued ? (
              <p role="status" className="text-body text-label-secondary">
                {text("pageEmpty")}
              </p>
            ) : (
              <EmptyState
                icon={activeType ? ICONS[activeType] : List}
                glyphColor={filterCfg ? filterCfg.color : "lists"}
                illustration={
                  activeType === "grocery"
                    ? ILLUSTRATIONS.groceriesClear
                    : activeType === "meal_plan"
                      ? ILLUSTRATIONS.mealsEmpty
                      : ILLUSTRATIONS.listsEmpty
                }
                title={text(filterCfg ? filterCfg.emptyKey : "empty")}
                description={
                  activeType === "meal_plan"
                    ? text("mealsNow")
                    : canCreate
                      ? filterCfg
                        ? text(filterCfg.createFirstKey)
                        : text("createFirst")
                      : text("askParent")
                }
                action={
                  canCreateHere ? (
                    <Link href={createHref} className="btn-filled">
                      <Plus className="w-4 h-4" />
                      <span>{text("create")}</span>
                    </Link>
                  ) : undefined
                }
              />
            )}
            {paging && (paging.continued || paging.nextHref) && (
              <nav aria-label={text("pages")} className="flex flex-wrap gap-2">
                {paging.continued && (
                  <Link href={paging.firstHref} className="btn-tinted min-h-11">
                    {text("firstPage")}
                  </Link>
                )}
                {paging.nextHref && (
                  <Link
                    href={paging.nextHref}
                    prefetch={false}
                    className="btn-filled min-h-11"
                  >
                    {text("nextPage")}
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
