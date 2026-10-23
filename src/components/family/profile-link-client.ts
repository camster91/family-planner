"use client";
import { z } from "zod";
import {
  profileLinkReceipt,
  type ProfileLinkReceipt,
} from "@/lib/profile-account-link-contract";
import { readApiErrorCode } from "@/lib/household-profile-types";

const result = z
  .object({
    links: z.array(profileLinkReceipt),
    profileAccountLinkSupported: z.literal(true),
  })
  .strict();
export class ProfileLinkClientError extends Error {
  constructor(public code: string) {
    super("Profile link request failed");
  }
}
export async function requestProfileLink(
  command?: unknown,
): Promise<ProfileLinkReceipt[]> {
  const response = await fetch(
    "/api/family/profile-links",
    command === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        },
  );
  const body: unknown = await response.json();
  if (!response.ok)
    throw new ProfileLinkClientError(
      readApiErrorCode(body) ?? "PROFILE_LINK_FAILED",
    );
  const parsed = result.safeParse(body);
  if (!parsed.success) throw new ProfileLinkClientError("PROFILE_LINK_FAILED");
  if (
    new Set(parsed.data.links.map((row) => row.id)).size !==
    parsed.data.links.length
  )
    throw new ProfileLinkClientError("PROFILE_LINK_FAILED");
  return parsed.data.links;
}
export function oneLink(
  links: ProfileLinkReceipt[],
  expected: Partial<ProfileLinkReceipt>,
) {
  const row = links[0];
  if (
    links.length !== 1 ||
    !row ||
    Object.entries(expected).some(
      ([key, value]) => row[key as keyof ProfileLinkReceipt] !== value,
    )
  )
    throw new ProfileLinkClientError("PROFILE_LINK_FAILED");
  return row;
}
export function linkErrorKey(
  error: unknown,
): "unsupported" | "conflict" | "proof" | "error" {
  const code = error instanceof ProfileLinkClientError ? error.code : "";
  return code === "PROFILE_LINK_UNSUPPORTED"
    ? "unsupported"
    : code === "PROFILE_LINK_REAUTH_REQUIRED"
      ? "proof"
      : ["PROFILE_LINK_CONFLICT", "PROFILE_LINK_UNAVAILABLE"].includes(code)
        ? "conflict"
        : "error";
}
