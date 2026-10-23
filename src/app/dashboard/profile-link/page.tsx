import ProfileAccountLinkClaim from "@/components/family/ProfileAccountLinkClaim";
import type { Metadata } from "next";
export const metadata: Metadata = { referrer: "no-referrer" };
/** Exact child/teen allowlisted route. All data and owner proof require a real session. */
export default function ProfileLinkPage() {
  return <ProfileAccountLinkClaim />;
}
