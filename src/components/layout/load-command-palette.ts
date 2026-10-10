/** Import only after a person opens search; a failed download can be retried. */
export async function loadCommandPalette() {
  return (await import("./CommandPalette")).default;
}
