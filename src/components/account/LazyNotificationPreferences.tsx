"use client";

import { useEffect, useState } from "react";
import { loadNotificationPreferences } from "./load-notification-preferences";
import {
  NotificationPreferencesLoading,
  NotificationPreferencesFailure,
} from "./NotificationPreferencesStatus";

/** The enclosing existing dialog owns focus, dismissal and role restrictions. */
export default function LazyNotificationPreferences() {
  const [Controls, setControls] = useState<Awaited<
    ReturnType<typeof loadNotificationPreferences>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void loadNotificationPreferences()
      .then((Loaded) => {
        if (active) setControls(() => Loaded);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (Controls) return <Controls />;
  if (failed)
    return (
      <NotificationPreferencesFailure
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  return <NotificationPreferencesLoading />;
}
