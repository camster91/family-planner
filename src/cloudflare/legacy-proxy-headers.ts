/**
 * Headers used only on the authenticated cross-account legacy proxy hop.
 *
 * Keep these names in one small shared module so the alias proxy and the
 * application ingress cannot drift. The values are never exposed to clients
 * and are removed before a request reaches Next/OpenNext.
 */
export const LEGACY_PROXY_SECRET_HEADER = "x-herewoven-proxy-key";
export const LEGACY_PROXY_IP_HEADER = "x-herewoven-client-ip";
