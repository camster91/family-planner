import { isProfileChoreEnabled } from "@/lib/profile-chore-gates";

export const PROFILE_LINK_ENABLE_ENV = "HOUSEHOLD_PROFILE_LINK_ENABLED";
/** Off until migration, owner-proof, lifecycle and installed-client QA pass. */
export function isProfileAccountLinkEnabled() {
  return (
    process.env[PROFILE_LINK_ENABLE_ENV] === "1" &&
    process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED === "1" &&
    isProfileChoreEnabled()
  );
}
