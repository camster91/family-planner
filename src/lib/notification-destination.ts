/** Shared notification navigation contract. Stored strings are never arbitrary URLs.
 * Extend only with a canonical destination and its role/deletion recovery contract.
 * Today is the sole destination currently emitted by the canonical summary sender.
 */
export function notificationDestination(value: unknown): "/dashboard/today" | null {
  return value === "/dashboard/today" ? "/dashboard/today" : null;
}
