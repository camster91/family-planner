import { decryptSecret } from "@/lib/secret-box";
import { feedUrlHint } from "./url-hint";

/** Client-facing shape. The URL itself is never included; parents get a host-only hint. */
export interface SubscriptionDto {
  id: string;
  name: string;
  color: string | null;
  url_hint?: string;
  last_fetched_at: string | null;
  last_status: string;
  last_error: string | null;
  created_at: string;
}

export function toSubscriptionDto(
  sub: {
    id: string;
    name: string;
    color?: string | null;
    url_enc?: string | null;
    last_fetched_at?: Date | null;
    last_status?: string | null;
    last_error?: string | null;
    created_at?: Date | null;
  },
  opts: { includeUrlHint?: boolean } = {},
): SubscriptionDto {
  const dto: SubscriptionDto = {
    id: sub.id,
    name: sub.name,
    color: sub.color ?? null,
    last_fetched_at: sub.last_fetched_at
      ? new Date(sub.last_fetched_at).toISOString()
      : null,
    last_status: sub.last_status ?? "pending",
    last_error: sub.last_error ?? null,
    created_at: sub.created_at
      ? new Date(sub.created_at).toISOString()
      : new Date(0).toISOString(),
  };
  if (opts.includeUrlHint)
    dto.url_hint = feedUrlHint(decryptSecret(sub.url_enc));
  return dto;
}

