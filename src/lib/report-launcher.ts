/**
 * Opens the private "Report / Suggest" form (the assistant panel's report
 * tab, mounted by AssistantHost in the dashboard layout).
 *
 * The form used to have a floating pill on every page. It is now opened from
 * Help and from the user menu, which dispatch this window event; AssistantHost
 * listens for it. Tiny on purpose, so those callers do not pull in the
 * assistant code.
 */
export const REPORT_OPEN_EVENT = "herewoven:report-open";

export function openReportForm(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(REPORT_OPEN_EVENT));
}
