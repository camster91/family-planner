/** Local shortcuts, not a language model or permission/action parser. */
export type DeviceHelperTopic = "schedule" | "dinner" | "chores" | "groceries";
export const MAX_DEVICE_HELPER_QUESTION = 240;

/** Only known whole-question phrases resolve. Never guess from one keyword:
 * “delete groceries” and “what is tomorrow's dinner?” must not show today's data.
 * Unknown/private/multi-part requests stay unanswered and keep the quick choices.
 */
export function deviceHelperQuestion(value: string): DeviceHelperTopic | null {
  if (value.length > MAX_DEVICE_HELPER_QUESTION) return null;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[¿?¡!.]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  const questions: Record<DeviceHelperTopic, readonly string[]> = {
    schedule: [
      "whats next",
      "whats next today",
      "what is next today",
      "whats on today",
      "what is on today",
      "todays schedule",
      "schedule",
      "calendar",
      "que sigue hoy",
      "que hay hoy",
      "agenda de hoy",
      "calendario",
    ],
    dinner: [
      "whats for dinner",
      "what is for dinner",
      "whats for dinner tonight",
      "what is for dinner tonight",
      "what are we eating tonight",
      "dinner",
      "tonights dinner",
      "que hay para cenar",
      "que cenamos hoy",
      "que vamos a cenar",
      "cena",
    ],
    chores: [
      "which chores are left",
      "what chores are left",
      "what chores are left today",
      "todays chores",
      "chores",
      "que tareas quedan",
      "que tareas quedan hoy",
      "tareas de hoy",
      "tareas",
    ],
    groceries: [
      "what do we need to buy",
      "what groceries do we need",
      "whats on the grocery list",
      "what is on the grocery list",
      "groceries",
      "shopping list",
      "grocery list",
      "que necesitamos comprar",
      "que hay en la lista de compras",
      "lista de compras",
      "compras",
    ],
  };
  return (
    (Object.keys(questions) as DeviceHelperTopic[]).find((topic) =>
      questions[topic].includes(normalized),
    ) ?? null
  );
}
