/** Content-free canonical refresh signal after matching committed proof only. */
export const PREPARATION_CHANGED_EVENT = "herewoven:preparation-changed";
export function notifyPreparationChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(PREPARATION_CHANGED_EVENT));
}
