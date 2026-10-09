"use client";
import { useTranslation } from "@/i18n";
import {
  storeSectionMessages,
  type StoreSectionMessage,
} from "./store-section-messages";
export {
  storeSectionsEnglish,
  storeSectionsSpanish,
  storeSectionMessages,
  type StoreSectionMessage,
} from "./store-section-messages";

/** Same locale/QA template rules as root messages; this dictionary stays route-owned. */
export function useStoreSectionText() {
  const { t: translate } = useTranslation();
  return (key: StoreSectionMessage, params?: Record<string, string | number>) =>
    translate(key, params, storeSectionMessages);
}
