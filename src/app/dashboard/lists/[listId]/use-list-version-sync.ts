"use client";

import * as React from "react";
import { useBoardSync } from "@/components/fridge/use-board-sync";

/** The shared bounded poller, with list-specific authorization and copy. */
export function useListVersionSync({
  listId,
  version,
  generatedAt,
  refresh,
}: {
  listId: string;
  version?: string;
  generatedAt?: string;
  refresh: () => void;
}) {
  const active = React.useRef(false);
  React.useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const safeRefresh = () => {
    if (active.current) refresh();
  };
  const [terminal, setTerminal] = React.useState(false);
  const checkVersion = async () => {
    const response = await fetch(
      `/api/lists/${encodeURIComponent(listId)}/version`,
      { cache: "no-store" },
    );
    if (!active.current) throw new Error("List view closed");
    if ([401, 403, 404].includes(response.status)) {
      setTerminal(true);
      safeRefresh();
      throw new Error("List access changed");
    }
    if (!response.ok) throw new Error("Could not check list changes");
    const body = await response.json();
    if (!active.current) throw new Error("List view closed");
    if (
      typeof body.version !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.version)
    )
      throw new Error("Invalid list version");
    return body.version;
  };
  const sync = useBoardSync({
    version,
    generatedAt: generatedAt ?? "",
    checkVersion,
    refresh: safeRefresh,
    enabled: Boolean(version) && !terminal,
    announcementMessage: "The list has been updated.",
  });
  return { ...sync, terminal };
}
