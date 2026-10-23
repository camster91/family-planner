"use client";
import * as React from "react";
import { LayoutGrid } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { useMoreText } from "@/i18n/more";

/** The feature catalog is only needed after a person opens Explore. */
const LazyExploreBrowser = React.lazy(() => import("./ExploreBrowser"));

export default function ExplorePanel({ role }: { role: string }) {
  const [open, setOpen] = React.useState(false);
  const { locale } = useTranslation();
  const more = useMoreText();
  // Unknown claims never become a parent discovery surface.
  if (!["parent", "teen", "child"].includes(role)) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-tinted min-h-[44px]"
        aria-haspopup="dialog"
      >
        <LayoutGrid size={18} aria-hidden="true" />
        {more("title")}
      </button>
      {open && (
        <React.Suspense
          fallback={
            <Dialog
              open
              onClose={() => setOpen(false)}
              title={more("title")}
              closeLabel={locale === "es" ? "Cerrar" : "Close"}
              variant="form"
            >
              <p role="status">{more("title")}…</p>
            </Dialog>
          }
        >
          <Dialog
            open
            onClose={() => setOpen(false)}
            title={more("title")}
            closeLabel={locale === "es" ? "Cerrar" : "Close"}
            variant="form"
          >
            <LazyExploreBrowser
              role={role}
              inSheet
              onNavigate={() => setOpen(false)}
            />
          </Dialog>
        </React.Suspense>
      )}
    </>
  );
}
