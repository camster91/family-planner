"use client";

import { useEffect } from "react";
import { loadPostHog } from "@/lib/load-posthog";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;
    let active = true;
    void loadPostHog()
      .then((client) => {
        if (active)
          client.init(key, {
            api_host:
              process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
          });
      })
      .catch(() => {
        if (active) console.warn("Optional analytics could not initialize.");
      });
    return () => {
      active = false;
    };
  }, []);

  // Keep the application mounted while the optional SDK loads or fails.
  return <>{children}</>;
}
