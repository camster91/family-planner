/**
 * Toast text for a failed request, following KidHome: the server's `error`
 * when it gave one, otherwise a generic retry line. A thrown fetch (offline,
 * connection dropped) uses OFFLINE_MESSAGE.
 */
export const OFFLINE_MESSAGE = 'Check your connection and try again.'

export async function responseErrorMessage(res: Response): Promise<string> {
  const data: unknown = await res.json().catch(() => null)
  const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined
  return typeof error === 'string' && error.trim() ? error : 'Please try again.'
}
