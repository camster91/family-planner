/** Topic metadata only. Answers use the canonical translated Help content. */
import type { FeatureKey } from "@/lib/feature-flags";
import type { HelpMessage } from "@/i18n/help";
export type AppHelpTopic = {
  id: string;
  title: HelpMessage;
  answer: HelpMessage;
  href: string;
  feature?: FeatureKey;
};
export const APP_HELP_TOPICS: readonly AppHelpTopic[] = [
  {
    id: "setup",
    title: "create",
    answer: "createHelp",
    href: "/dashboard/family/create",
  },
  {
    id: "family",
    title: "invite",
    answer: "inviteHelp",
    href: "/dashboard/family/invite",
    feature: "family",
  },
  {
    id: "calendar",
    title: "calendar",
    answer: "calendarHelp",
    href: "/dashboard/calendar",
    feature: "calendar",
  },
  {
    id: "meals",
    title: "meals",
    answer: "mealsHelp",
    href: "/dashboard/meals",
    feature: "meals",
  },
  {
    id: "lists",
    title: "lists",
    answer: "listsHelp",
    href: "/dashboard/lists",
    feature: "lists",
  },
  {
    id: "rewards",
    title: "rewards",
    answer: "rewardsHelp",
    href: "/dashboard/rewards",
    feature: "rewards",
  },
  {
    id: "password",
    title: "password",
    answer: "passwordHelp",
    href: "/forgot-password",
  },
  { id: "privacy", title: "privacy", answer: "privacyHelp", href: "/privacy" },
  {
    id: "export",
    title: "export",
    answer: "exportHelp",
    href: "/dashboard/settings#settings-privacy",
  },
];
