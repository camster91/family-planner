/** Fixed audit vocabulary, safe for server and localized browser projections. */
export const AUDIT_ACTIONS = [
  "feature.turned_on",
  "feature.turned_off",
  "member.joined",
  "member.left",
  // O-34: a parent removed a member; a parent got a new family code.
  "member.removed",
  "invite_code.rotated",
  "board_settings.changed",
  "device.paired",
  "device.renamed",
  "device.removed",
  "invite.created",
  "invite.revoked",
  "beta_metrics.turned_on",
  "beta_metrics.turned_off",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
