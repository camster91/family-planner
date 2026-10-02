// Kept apart from ./capture so the Settings page can read it without loading
// the provider client.
//
// Whether Settings shows the per-family "AI capture" key form. Default OFF:
// AI features wait for Cameron to approve a provider, and the provider URL /
// model / key fields are jargon for most parents. Only an explicit
// CAPTURE_AI_SETTINGS_ENABLED=1 or =true shows it. A family that already saved
// a key still sees the form (decided in the Settings page) so it can remove it.
// The API and capture itself are unchanged either way.
export function isCaptureAiSettingsEnabled(): boolean {
  const raw = (process.env.CAPTURE_AI_SETTINGS_ENABLED ?? '').trim().toLowerCase()
  return raw === 'true' || raw === '1'
}
