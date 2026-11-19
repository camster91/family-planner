/**
 * Several items typed at once in a list's add field ("milk, eggs and 2
 * bread", or one per line). Splits on new lines, commas and the word "and"
 * ("y" too in Spanish); a leading whole number becomes the quantity.
 *
 * Returns null when the text is one item, so a single add keeps exactly the
 * request it always sent (a leading number then stays part of the name).
 */
export type SplitItem = { content: string; quantity: number };

export function splitListItems(
  text: string,
  locale: string = "en",
): SplitItem[] | null {
  const joiner = locale === "es" ? /\s+(?:and|y)\s+/i : /\s+and\s+/i;
  const parts = text
    .split(/[\n\r,]+/)
    .flatMap((part) => part.split(joiner))
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  return parts.map((part) => {
    const match = /^(\d{1,4})\s*(?:x|×)?\s+(\S.*)$/i.exec(part);
    const quantity = match ? Number(match[1]) : 0;
    return match && quantity >= 1
      ? { content: match[2].trim(), quantity }
      : { content: part, quantity: 1 };
  });
}

/** How an item reads in the preview and when put back in the field. */
export function splitItemText(item: SplitItem): string {
  return item.quantity > 1 ? `${item.quantity} ${item.content}` : item.content;
}
