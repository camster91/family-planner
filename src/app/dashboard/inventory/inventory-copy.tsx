"use client";
import { useTranslation } from "@/i18n";
import {
  inventoryMessages,
  type InventoryFeedback,
  type InventoryMessage,
} from "@/i18n/inventory";
export function useInventoryCopy() {
  const { t } = useTranslation();
  return (key: InventoryMessage, params?: Record<string, string | number>) =>
    t(key, params, inventoryMessages);
}
/** A stored message follows locale changes without replacing its state or replaying work. */
export function InventoryText({ feedback }: { feedback: InventoryFeedback }) {
  const copy = useInventoryCopy();
  return (
    <>
      {"raw" in feedback ? feedback.raw : copy(feedback.key, feedback.params)}
    </>
  );
}
