/** Local presentation preferences, never authority or household feature flags. */
export const TODAY_SECTIONS = [
  "next",
  "dinner",
  "groceries",
  "coming",
  "usesoon",
] as const;
export type TodaySection = (typeof TODAY_SECTIONS)[number];
export type TodayLayout = {
  order: TodaySection[];
  hidden: TodaySection[];
  density: "comfortable" | "compact";
  includeChores: boolean;
  calendarView: "day" | "week" | "agenda";
};
export type PersonalLayout = { today: TodayLayout; favorites: string[] };
export const MAX_FAVORITES = 8;
export function defaultPersonalLayout(): PersonalLayout {
  return {
    today: {
      order: [...TODAY_SECTIONS],
      hidden: [],
      density: "comfortable",
      includeChores: true,
      calendarView: "agenda",
    },
    favorites: [],
  };
}
function isSection(value: unknown): value is TodaySection {
  return (
    typeof value === "string" &&
    (TODAY_SECTIONS as readonly string[]).includes(value)
  );
}
export function normalizePersonalLayout(value: unknown): PersonalLayout {
  const fallback = defaultPersonalLayout();
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Record<string, unknown>;
  const today =
    raw.today && typeof raw.today === "object"
      ? (raw.today as Record<string, unknown>)
      : {};
  const order = Array.isArray(today.order)
    ? [...new Set(today.order.filter(isSection))]
    : [];
  return {
    today: {
      order: [
        ...order,
        ...TODAY_SECTIONS.filter((section) => !order.includes(section)),
      ],
      // Next up remains a useful anchor even if stale/corrupt storage hides every card.
      hidden: Array.isArray(today.hidden)
        ? [...new Set(today.hidden.filter(isSection))].filter(
            (section) => section !== "next",
          )
        : [],
      density: today.density === "compact" ? "compact" : "comfortable",
      includeChores:
        typeof today.includeChores === "boolean" ? today.includeChores : true,
      calendarView:
        today.calendarView === "day" || today.calendarView === "week"
          ? today.calendarView
          : "agenda",
    },
    favorites: Array.isArray(raw.favorites)
      ? [
          ...new Set(
            raw.favorites.filter(
              (item): item is string =>
                typeof item === "string" && /^[a-z][a-z-]{0,39}$/.test(item),
            ),
          ),
        ].slice(0, MAX_FAVORITES)
      : [],
  };
}
