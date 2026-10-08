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
import { useRouter } from "next/navigation";
import { Glyph } from "@/components/ui/glyph";
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
};

// -----------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------

interface ListSummary {
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
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function ListsClient({
  lists,
  familyName,
  canCreate = true,
  initialType = null,
}: ListsClientProps) {
  const router = useRouter();
  const { t, locale } = useTranslation();
  const text = (
    key: ListOverviewMessage,
    params?: Record<string, string | number>,
  ) => t(`listOverview.${key}`, params);
  const pluralRules = new Intl.PluralRules(locale);
  // The type cards filter this page (route inventory F-6); the old
  // /dashboard/lists/type/[type] pages redirect here with `?type=`.
  const [typeFilter, setTypeFilter] = React.useState<ListTypeKey | null>(() =>
    listTypeFilter(initialType),
  );
  const applyFilter = (next: ListTypeKey | null) => {
    setTypeFilter(next);
    router.replace(listsFilterHref(next), { scroll: false });
  };
  const shown = typeFilter ? lists.filter((l) => l.type === typeFilter) : lists;
  const filterCfg = typeFilter ? TYPE_CONFIG[typeFilter] : null;
  // ADR-0007 O-8: no new 'meal_plan' lists (existing ones stay readable).
  const createHref =
    typeFilter && typeFilter !== "meal_plan"
      ? `/dashboard/lists/create?type=${typeFilter}`
      : "/dashboard/lists/create";
  const canCreateHere = canCreate && typeFilter !== "meal_plan";

  // Main type cards at the top. 'meal_plan' is no longer a list type people
  // create (ADR-0007 O-8; meals live in /dashboard/meals), so its card shows
  // only while the household still has such lists, which keep opening as before.
  const hasMealPlanLists = lists.some((l) => l.type === "meal_plan");
  const mainTypes: ListTypeKey[] = hasMealPlanLists
    ? ["grocery", "todo", "meal_plan", "wishlist"]
    : ["grocery", "todo", "wishlist"];

  return (
    <div className="pb-20">
      <LargeHeader
        greeting={familyName}
        title={text("title")}
        trailing={
          canCreate ? (
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
        {/* Type cards: each one filters the lists below (pressed again, shows all). */}
        <section aria-label={text("filter")}>
          <div className="grid grid-cols-2 gap-3">
            {mainTypes.map((type) => {
              const cfg = TYPE_CONFIG[type];
              const Icon = ICONS[type];
              const count = lists.filter((l) => l.type === type).length;
              const pressed = typeFilter === type;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => applyFilter(pressed ? null : type)}
                  className={
                    "card-apple p-4 min-h-[44px] flex flex-col items-center gap-2 text-center active:scale-95 motion-reduce:active:scale-100 transition-transform focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]" +
                    (pressed ? " ring-2 ring-[var(--accent)]" : "")
                  }
                >
                  <Glyph color={cfg.color} size="lg">
                    <Icon className="w-6 h-6 text-white" />
                  </Glyph>
                  <span className="text-subhead text-label-primary font-medium">
                    {text(cfg.nameKey)}
                  </span>
                  {count > 0 && (
                    <span className="text-caption-1 text-label-tertiary">
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

        {/* All lists, or the lists of the chosen type */}
        {filterCfg && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-subhead text-label-secondary" role="status">
              {text(filterCfg.showingKey)}
            </p>
            <button
              type="button"
              onClick={() => applyFilter(null)}
              className="inline-flex min-h-[44px] items-center rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]"
            >
              {text("showAll")}
            </button>
          </div>
        )}
        {shown.length > 0 ? (
          <section>
            <SectionHeader>
              {text(filterCfg ? filterCfg.headingKey : "all")}
            </SectionHeader>
            <InsetList>
              {shown.map((list, i) => {
                const cfg = TYPE_CONFIG[listTypeFilter(list.type) ?? "grocery"];
                const Icon = ICONS[list.type] || ShoppingCart;
                return (
                  <ListRow
                    key={list.id}
                    href={`/dashboard/lists/${list.id}`}
                    icon={Icon}
                    glyphColor={cfg.color}
                    title={list.name}
                    subtitle={list.creator.name}
                    trailing={
                      list.total_count > 0 ? (
                        <span className="text-footnote text-label-tertiary">
                          {list.checked_count}/{list.total_count}
                        </span>
                      ) : undefined
                    }
                    last={i === shown.length - 1}
                  />
                );
              })}
            </InsetList>
          </section>
        ) : (
          <EmptyState
            icon={typeFilter ? ICONS[typeFilter] : List}
            glyphColor={filterCfg ? filterCfg.color : "lists"}
            illustration={
              typeFilter === "grocery"
                ? ILLUSTRATIONS.groceriesClear
                : typeFilter === "meal_plan"
                  ? ILLUSTRATIONS.mealsEmpty
                  : ILLUSTRATIONS.listsEmpty
            }
            title={text(filterCfg ? filterCfg.emptyKey : "empty")}
            description={
              typeFilter === "meal_plan"
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
      </div>
    </div>
  );
}
