"use client";
import * as React from "react";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { PreparationButton } from "./PreparationProvider";
/** Personal entry only; hydration chooses the same local zone used by Today.
 * No cached readiness/progress is inferred from the presence of a relationship. */
export function PreparationEntry({
  eventId,
  backlink = false,
}: {
  eventId: string;
  backlink?: boolean;
}) {
  const [zone, setZone] = React.useState<string | null>(null);
  React.useEffect(() => {
    try {
      const value = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isValidTimeZone(value)) setZone(value);
    } catch {
      /* No guessed zone: canonical day cues need an explicit zone. */
    }
  }, []);
  return zone ? (
    <PreparationButton
      location={{ eventId, timeZone: zone }}
      backlink={backlink}
    />
  ) : null;
}
