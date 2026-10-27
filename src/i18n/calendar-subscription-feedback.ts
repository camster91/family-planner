/** Fixed historical subscription vocabulary; never echo arbitrary server/provider text. */
import type { SettingsMessage } from "./settings";
export type CalendarSubscriptionFeedback = { key: SettingsMessage; params?: Record<string, string | number> };
const messages: Readonly<Record<string, SettingsMessage>> = {
  "Calendar subscription not found": "calendarSubscriptionMissing",
  "Feed address is not allowed": "calendarFeedAddress",
  "Feed took too long to respond": "calendarFeedTimeout",
  "Feed is larger than 2 MB": "calendarFeedDownloadLarge",
  "Feed redirected too many times": "calendarFeedRedirects",
  "Feed could not be downloaded": "calendarFeedDownload",
  "Could not reach the feed": "calendarFeedNetwork",
  "Feed is not a valid calendar": "calendarFeedInvalid",
  "Saved calendar link could not be read. Remove and add it again.": "calendarFeedUnreadable",
  "Calendar feed is too large to refresh safely. Existing events were kept.": "calendarFeedExpandedLarge",
  "Could not save events from this calendar": "calendarFeedSaveFailed",
  "Could not refresh this calendar": "refreshFailed",
  "That calendar link is not valid": "calendarLinkInvalid",
  "Calendar links must start with https:// or webcal://": "calendarLinkScheme",
  "Calendar links must not contain a username or password": "calendarLinkCredentials",
  "Calendar links must point to a public address": "calendarLinkPublic",
  "Give the calendar a name": "calendarNameRequired",
  "Name is too long": "calendarNameLong",
  "Paste the calendar link": "calendarLinkRequired",
  "That link is too long": "calendarLinkLong",
  "Colour must look like #1a2b3c": "calendarColorInvalid",
  "A household can subscribe to at most 10 calendars": "calendarSubscriptionLimit",
};
export function calendarSubscriptionFeedback(raw: unknown, fallback: SettingsMessage): CalendarSubscriptionFeedback {
  if (typeof raw !== "string") return { key: fallback };
  const key = Object.prototype.hasOwnProperty.call(messages, raw) ? messages[raw] : null;
  if (key) return { key };
  const http = /^Feed could not be downloaded \(HTTP ([1-5][0-9]{2})\)$/.exec(raw);
  return http ? { key: "calendarFeedHttp", params: { status: Number(http[1]) } } : { key: fallback };
}
