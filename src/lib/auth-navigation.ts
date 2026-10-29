/**
 * Leave the client router behind when an auth cookie changes.
 *
 * Login, registration and logout change the server-side authority that the
 * current App Router tree was rendered from. A document replacement makes
 * the browser establish one fresh request with the new cookie state instead
 * of racing a push against a second router refresh.
 */
export function replaceWithFreshDocument(path: string): void {
  window.location.replace(path);
}
