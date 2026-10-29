/**
 * Runtime-safe route error logging with no Next.js HTTP dependencies.
 *
 * Native Worker/domain kernels import this module instead of the HTTP error
 * envelope. `route` is always a fixed label; exception messages, stacks,
 * request bodies, URLs, users and household identifiers never enter logs.
 */
import { describeError, log } from "@/lib/logger";

/** Log an unexpected route failure as one privacy-safe structured line. */
export function logRouteError(
  route: string,
  error: unknown,
  requestId: string | undefined,
): void {
  log.error("route.error", routeErrorContext(route, error, requestId));
}

/** Log a recovered route failure at warning level. */
export function logRouteWarning(
  route: string,
  error: unknown,
  requestId: string | undefined,
): void {
  log.warn("route.warn", routeErrorContext(route, error, requestId));
}

function routeErrorContext(
  route: string,
  error: unknown,
  requestId: string | undefined,
) {
  return {
    route: route.slice(0, 120),
    ...(requestId === undefined ? {} : { requestId }),
    ...describeError(error),
  };
}
