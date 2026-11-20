"use client";

import { useEffect, useState } from "react";
import {
  loadNotificationPreferences,
  loadQuietDisplayControl,
} from "./load-notification-preferences";
import {
  NotificationPreferencesLoading,
  NotificationPreferencesFailure,
} from "./NotificationPreferencesStatus";

type Loaded = {
  Controls: Awaited<ReturnType<typeof loadNotificationPreferences>>;
  Quiet: Awaited<ReturnType<typeof loadQuietDisplayControl>> | null;
};

/**
 * The enclosing existing dialog owns focus, dismissal and role restrictions.
 * `withQuietView` also loads the Quiet view switch (child user menu), in the
 * same deferred step, so neither is in the dashboard's initial JavaScript and
 * one "Try again" recovers both.
 */
export default function LazyNotificationPreferences({
  withQuietView = false,
}: {
  withQuietView?: boolean;
} = {}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void Promise.all([
      loadNotificationPreferences(),
      withQuietView ? loadQuietDisplayControl() : null,
    ])
      .then(([Controls, Quiet]) => {
        if (active) setLoaded({ Controls, Quiet });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, withQuietView]);
  if (loaded) {
    const { Controls, Quiet } = loaded;
    return (
      <>
        <Controls />
        {withQuietView && Quiet && (
          <div className="mt-4">
            <Quiet />
          </div>
        )}
      </>
    );
  }
  if (failed)
    return (
      <NotificationPreferencesFailure
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  return <NotificationPreferencesLoading />;
}
