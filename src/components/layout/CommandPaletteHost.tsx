"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { navigationMessages, type NavigationMessage } from "@/i18n/navigation";
import { loadCommandPalette } from "./load-command-palette";

/**
 * Load the palette on first use, then retain it for subsequent openings.
 * The host owns the global event and shortcut so both work before loading.
 * Lives at the layout level
 * so it overlays every dashboard page.
 */
export default function CommandPaletteHost({ role }: { role?: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [Palette, setPalette] = React.useState<Awaited<
    ReturnType<typeof loadCommandPalette>
  > | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const { t } = useTranslation();
  const msg = (key: NavigationMessage) => t(key, undefined, navigationMessages);
  React.useEffect(() => {
    if (!loaded || Palette) return;
    let active = true;
    setFailed(false);
    void loadCommandPalette()
      .then((component) => {
        if (active) setPalette(() => component);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [loaded, Palette, attempt]);

  React.useEffect(() => {
    function onOpen() {
      setLoaded(true);
      setOpen(true);
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setLoaded(true);
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("open-command-palette", onOpen);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("open-command-palette", onOpen);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  if (Palette)
    return <Palette open={open} onClose={() => setOpen(false)} role={role} />;
  if (!open) return null;
  return (
    <Dialog
      open
      onClose={() => setOpen(false)}
      title={msg("search")}
      closeLabel={msg("close")}
    >
      {failed ? (
        <>
          <p role="alert">{msg("searchLoadFailed")}</p>
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {msg("retry")}
          </button>
        </>
      ) : (
        <p role="status">{msg("searchLoading")}</p>
      )}
    </Dialog>
  );
}
