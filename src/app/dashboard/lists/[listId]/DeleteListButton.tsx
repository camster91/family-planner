"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";

export default function DeleteListButton({
  listId,
  listName,
}: {
  listId: string;
  listName: string;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<"failed" | "network" | null>(null);
  const router = useRouter();
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deletingRef = useRef(false);

  const openConfirmation = () => {
    if (deletingRef.current) return;
    setError(null);
    setConfirmOpen(true);
  };

  const closeConfirmation = () => {
    if (deletingRef.current) return;
    setError(null);
    setConfirmOpen(false);
  };

  const handleDelete = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError(null);
    try {
      // Get CSRF token from cookie
      const csrfMatch = document.cookie
        .split("; ")
        .find((c) => c.startsWith("csrf_token="));
      const csrf = csrfMatch ? csrfMatch.split("=")[1] : "";

      const res = await fetch("/api/lists", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ listId }),
      });
      if (!res.ok) {
        setError("failed");
        return;
      }
      setConfirmOpen(false);
      router.push("/dashboard/lists");
      router.refresh();
    } catch {
      setError("network");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={openConfirmation}
        disabled={deleting}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-label-tertiary active:text-[var(--tint-rewards)] active:bg-[var(--surface-fill)] disabled:opacity-50"
        aria-label={t("listOverview.deleteButton", { name: listName })}
      >
        <Trash2 className="w-4 h-4" aria-hidden="true" />
      </button>
      {confirmOpen && (
        <Dialog
          open
          role="alertdialog"
          testId="delete-list-dialog"
          title={t("listOverview.deleteTitle", { name: listName })}
          description={t("listOverview.deleteDescription", { name: listName })}
          initialFocusRef={cancelRef}
          onClose={deleting ? undefined : closeConfirmation}
          closeLabel={t("listOverview.deleteClose")}
        >
          <div aria-busy={deleting}>
            {error && (
              <p role="alert" className="mb-4 text-sm text-danger-text">
                {error === "network"
                  ? t("listOverview.deleteNetworkError")
                  : t("listOverview.deleteFailed")}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                ref={cancelRef}
                type="button"
                disabled={deleting}
                onClick={closeConfirmation}
                className="min-h-[44px] min-w-[44px] rounded-lg border border-input px-4 text-foreground disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="btn-destructive min-h-[44px] min-w-[44px] px-4 disabled:opacity-60"
              >
                {deleting
                  ? t("listOverview.deleteDeleting")
                  : error
                    ? t("routeState.tryAgain")
                    : t("common.delete")}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
