"use client";

import { createContext, useContext, type ReactNode } from "react";

const EventRemindersContext = createContext(false);

/** Whether in-app event reminders are on (server flag), for controls that only make sense with them. */
export function EventRemindersProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <EventRemindersContext.Provider value={enabled}>{children}</EventRemindersContext.Provider>;
}
export const useEventRemindersSupported = () => useContext(EventRemindersContext);
