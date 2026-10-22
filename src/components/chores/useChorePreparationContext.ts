"use client";
import * as React from "react";
import { requestOwnedJson } from "@/lib/owned-request-http";
import {
  chorePreparationContext,
  type ChorePreparationContext,
} from "@/lib/event-preparation/origin-contract";
type Identity = { userId: string; familyId: string };
const personal = () =>
  typeof window !== "undefined" &&
  document.visibilityState === "visible" &&
  !window.location.pathname.startsWith("/device") &&
  !new URLSearchParams(window.location.search)
    .getAll("mode")
    .includes("fridge");
/** Separate personal projection, never part of a Chore/shared/offline DTO.
 * Initial and later history windows use the same parent/generation boundary.
 */
export function useChorePreparationContext(
  identity: Identity | undefined,
  choreIds: string[],
  active = true,
): Pick<ChorePreparationContext, "backlinks" | "origins"> {
  const signature = JSON.stringify([...new Set(choreIds)].sort()),
    scope = JSON.stringify(identity ?? null);
  const initial = React.useRef(scope),
    owner = React.useRef<ChorePreparationContext["owner"] | null>(null),
    retired = React.useRef(false);
  const [projection, setProjection] = React.useState<{
    scope: string;
    signature: string;
    backlinks: ChorePreparationContext["backlinks"];
    origins: ChorePreparationContext["origins"];
  } | null>(null);
  const epoch = React.useRef(0),
    request = React.useRef<AbortController | null>(null);
  const latest = React.useRef({ identity, signature, scope, active });
  latest.current = { identity, signature, scope, active };
  const clear = React.useCallback(() => {
    epoch.current++;
    request.current?.abort();
    request.current = null;
    setProjection(null);
  }, []);
  const refresh = React.useCallback(async () => {
    clear();
    const expected = latest.current;
    if (
      retired.current ||
      !expected.active ||
      !expected.identity ||
      !personal()
    )
      return;
    if (expected.scope !== initial.current) {
      retired.current = true;
      return;
    }
    const ids = JSON.parse(expected.signature) as string[];
    if (!ids.length) return;
    const token = epoch.current,
      controller = new AbortController();
    request.current = controller;
    const current = () =>
      epoch.current === token &&
      !controller.signal.aborted &&
      personal() &&
      latest.current.active &&
      latest.current.scope === expected.scope &&
      latest.current.signature === expected.signature;
    const backlinks: ChorePreparationContext["backlinks"] = {},
      origins: ChorePreparationContext["origins"] = {};
    try {
      for (let offset = 0; offset < ids.length; offset += 300) {
        const batch = ids.slice(offset, offset + 300),
          allowed = new Set(batch);
        const result = await requestOwnedJson(
          "/api/chores/preparation-context",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({ ids: batch }),
          },
          256 * 1024,
        );
        if (!current()) return;
        if (result.kind !== "reply") return;
        if ([401, 403].includes(result.response.status)) {
          retired.current = true;
          return;
        }
        if (!result.response.ok) return;
        const data = chorePreparationContext.parse(result.body),
          prior = owner.current;
        if (
          data.owner.userId !== expected.identity.userId ||
          data.owner.familyId !== expected.identity.familyId ||
          (prior &&
            (data.owner.userId !== prior.userId ||
              data.owner.familyId !== prior.familyId ||
              data.owner.generation !== prior.generation))
        ) {
          retired.current = true;
          return;
        }
        owner.current ??= data.owner;
        if (data.state === "paused") return;
        for (const [id, value] of Object.entries(data.backlinks))
          if (allowed.has(id)) backlinks[id] = value;
        for (const [id, value] of Object.entries(data.origins))
          if (allowed.has(id)) origins[id] = value;
      }
      if (current())
        setProjection({
          scope: expected.scope,
          signature: expected.signature,
          backlinks,
          origins,
        });
    } catch {
      /* Optional context never blocks canonical chore editing/completion. */
    } finally {
      if (request.current === controller) request.current = null;
    }
  }, [clear]);
  React.useEffect(() => {
    void refresh();
    return clear;
  }, [scope, signature, active, refresh, clear]);
  React.useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden") clear();
      else void refresh();
    };
    const focus = () => {
      void refresh();
    };
    window.addEventListener("blur", clear);
    window.addEventListener("storage", clear);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", clear);
      window.removeEventListener("storage", clear);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clear, refresh]);
  return active &&
    !retired.current &&
    personal() &&
    projection?.scope === scope &&
    projection.signature === signature
    ? { backlinks: projection.backlinks, origins: projection.origins }
    : { backlinks: {}, origins: {} };
}
