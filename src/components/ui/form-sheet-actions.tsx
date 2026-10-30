"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Actions stay outside the scrolling fields; buttons retain their form owner. */
export const FormSheetActionsHost = createContext<HTMLElement | null>(null);

export function FormSheetActions({ children }: { children: ReactNode }) {
  const host = useContext(FormSheetActionsHost);
  return host ? createPortal(children, host) : <>{children}</>;
}
