"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Pencil,
  Archive,
  Trash2,
  MoreHorizontal,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/dialog";
import { useTranslation } from "@/i18n";
import { useProjectDeleteText } from "@/i18n/project-delete";
import { useProjectOverviewText } from "@/i18n/project-overview";

interface ProjectDetailActionsProps {
  projectId: string;
  projectName: string;
  projectStatus: "active" | "completed" | "archived";
  isParent: boolean;
}

export function ProjectDetailActions({
  projectId,
  projectName,
  projectStatus,
  isParent,
}: ProjectDetailActionsProps) {
  const router = useRouter();
  const { addToast } = useToast();
  const { t } = useTranslation();
  const projectDeleteText = useProjectDeleteText();
  const text = useProjectOverviewText();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<"failed" | "network" | null>(
    null,
  );
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const deletingRef = useRef(false);

  // Menu keyboard support: focus the first item on open, Escape closes and
  // returns focus to the trigger, arrow keys move between items.
  useEffect(() => {
    if (!menuOpen) return;
    const items = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled])',
        ) ?? [],
      );
    items()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const list = items();
      if (list.length === 0) return;
      e.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === "ArrowDown"
          ? (at + 1) % list.length
          : (at - 1 + list.length) % list.length;
      list[next].focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const updateStatus = async (status: "active" | "completed" | "archived") => {
    setLoading(status);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : text("updateProjectError"),
        );

      addToast({
        type: "success",
        title:
          status === "completed"
            ? text("projectCompleted")
            : status === "archived"
              ? text("projectArchived")
              : text("projectReactivated"),
      });
      router.refresh();
    } catch (error) {
      addToast({
        type: "error",
        title: text("updateProjectError"),
        message:
          error instanceof Error ? error.message : text("taskUpdateFallback"),
      });
    } finally {
      setLoading(null);
      setMenuOpen(false);
    }
  };

  const openDeleteConfirmation = () => {
    if (deletingRef.current) return;
    setDeleteError(null);
    setMenuOpen(false);
    setDeleteOpen(true);
  };

  const closeDeleteConfirmation = () => {
    if (deletingRef.current) return;
    setDeleteError(null);
    setDeleteOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const deleteProject = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setLoading("delete");
    setDeleteError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setDeleteError("failed");
        return;
      }
      addToast({ type: "success", title: projectDeleteText("deleteSuccess") });
      setDeleteOpen(false);
      router.push("/dashboard/projects");
      router.refresh();
    } catch {
      setDeleteError("network");
    } finally {
      deletingRef.current = false;
      setLoading(null);
    }
  };

  interface Action {
    label: string;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    onClick: () => void;
    loading: boolean;
    className?: string;
  }

  const actions: Action[] = [];

  if (isParent) {
    if (projectStatus === "active") {
      actions.push({
        label: text("markComplete"),
        icon: CheckCircle2,
        onClick: () => updateStatus("completed"),
        loading: loading === "completed",
        className: "text-success-text",
      });
      actions.push({
        label: text("archive"),
        icon: Archive,
        onClick: () => updateStatus("archived"),
        loading: loading === "archived",
      });
    } else if (projectStatus === "completed") {
      actions.push({
        label: text("reactivate"),
        icon: RotateCcw,
        onClick: () => updateStatus("active"),
        loading: loading === "active",
      });
      actions.push({
        label: text("archive"),
        icon: Archive,
        onClick: () => updateStatus("archived"),
        loading: loading === "archived",
      });
    } else if (projectStatus === "archived") {
      actions.push({
        label: text("reactivate"),
        icon: RotateCcw,
        onClick: () => updateStatus("active"),
        loading: loading === "active",
      });
    }

    actions.push({
      label: projectDeleteText("deleteAction"),
      icon: Trash2,
      onClick: openDeleteConfirmation,
      loading: loading === "delete",
      className: "text-danger-text hover:bg-[var(--danger-tint)]",
    });
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        className="inline-flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
        {text("actions")}
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={text("projectActions")}
            className="absolute right-0 top-full mt-1 z-20 w-48 rounded-xl bg-card border shadow-lg py-1 overflow-hidden"
          >
            {actions.length === 0 && (
              <p className="px-4 py-3 text-sm text-label-secondary">
                {text("noActions")}
              </p>
            )}
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                onClick={action.onClick}
                disabled={!!action.loading}
                className={`flex min-h-[44px] items-center gap-2 w-full px-4 py-2.5 text-sm text-left hover:bg-muted transition-colors disabled:opacity-50 ${action.className || ""}`}
              >
                <action.icon className="w-4 h-4" aria-hidden="true" />
                {action.loading ? "…" : action.label}
              </button>
            ))}
          </div>
        </>
      )}

      {deleteOpen && (
        <Dialog
          open
          role="alertdialog"
          testId="delete-project-dialog"
          title={projectDeleteText("deleteTitle", { name: projectName })}
          description={projectDeleteText("deleteDescription", {
            name: projectName,
          })}
          initialFocusRef={cancelDeleteRef}
          onClose={loading === "delete" ? undefined : closeDeleteConfirmation}
          closeLabel={projectDeleteText("deleteClose")}
        >
          <div aria-busy={loading === "delete"}>
            {deleteError && (
              <p role="alert" className="mb-4 text-sm text-danger-text">
                {deleteError === "network"
                  ? projectDeleteText("deleteNetworkError")
                  : projectDeleteText("deleteFailed")}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                ref={cancelDeleteRef}
                type="button"
                disabled={loading === "delete"}
                onClick={closeDeleteConfirmation}
                className="min-h-[44px] min-w-[44px] rounded-lg border border-input px-4 text-foreground disabled:opacity-60"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={loading === "delete"}
                onClick={deleteProject}
                className="btn-destructive min-h-[44px] min-w-[44px] px-4 disabled:opacity-60"
              >
                {loading === "delete"
                  ? projectDeleteText("deleteDeleting")
                  : deleteError
                    ? t("routeState.tryAgain")
                    : t("common.delete")}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
