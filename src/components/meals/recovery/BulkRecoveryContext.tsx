"use client";
import * as React from "react";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import type { PrepDraft } from "@/lib/meal-prep-recovery/draft-contract";
import type { BulkRecovery } from "./useBulkRecovery";
const Context = React.createContext<BulkRecovery | null>(null);
export const BulkRecoveryProvider = Context.Provider;
export function useBulkRecoveryContext() {
  return React.useContext(Context);
}
/** One form reader supplies its latest render synchronously at Save/close.
 * Effects only stage local fields; no submit or restored retry runs on mount. */
export function useBulkFormDraft(draft: PrepDraft) {
  const recovery = useBulkRecoveryContext(),
    latest = React.useRef(recovery),
    raw = React.useRef(draft);
  latest.current = recovery;
  raw.current = draft;
  const [identity] = React.useState(newIdempotencyKey),
    encoded = JSON.stringify(draft),
    mode = recovery?.mode;
  const lifetime = React.useRef(0);
  React.useEffect(() => {
    if (mode !== "owned") return;
    lifetime.current++;
    void latest.current?.attach(() => raw.current, identity);
    return () => {
      const cleanup = ++lifetime.current;
      // Strict Mode immediately sets up the same form again. Retain that exact
      // reader, but retire real unmounts before the next user event.
      void Promise.resolve().then(() => {
        if (lifetime.current === cleanup) latest.current?.detach(identity);
      });
    };
  }, [mode, identity]);
  React.useEffect(() => {
    latest.current?.changed(identity);
  }, [encoded, identity]);
}
