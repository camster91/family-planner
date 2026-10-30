"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDraftAwareRouter as useRouter } from "@/components/layout/owned-draft-navigation";
import { useDashboardFrameText } from "@/i18n/dashboard-frame";
import { Dialog } from "@/components/ui/dialog";
import CreateListForm from "@/app/dashboard/lists/create/CreateListForm";
import CreateChoreForm from "@/app/dashboard/chores/create/CreateChoreForm";
import EditChoreForm from "@/app/dashboard/chores/edit/EditChoreForm";
import { useTranslation } from "@/i18n";
import { listCreateMessages } from "@/i18n/list-create";
import { choreFormMessages } from "@/i18n/chore-forms";
import type { ListTypeKey } from "@/lib/list-type-filter";
import {
  PendingFormNavigationProvider,
  usePendingFormNavigationController,
} from "./pending-form-navigation";

export function FormSheet({
  title,
  busy = false,
  children,
  description,
  closeLabel,
}: {
  title: string;
  busy?: boolean;
  children: ReactNode;
  description?: string;
  closeLabel?: string;
}) {
  const text = useDashboardFrameText();
  const router = useRouter();
  const navigation = usePendingFormNavigationController(busy);
  const close = async () => {
    if (!(await navigation.releaseBeforeNavigation())) return;
    router.back();
  };
  useEffect(() => {
    const background = document.querySelector<HTMLElement>(
      "[data-dashboard-background]",
    );
    const wasInert = background?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";
    return () => {
      if (background) background.inert = wasInert;
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <PendingFormNavigationProvider value={navigation}>
      <Dialog
        open
        title={title}
        variant="form"
        onClose={busy ? undefined : () => void close()}
        closeLabel={closeLabel ?? text("sheetClose")}
        description={
          description ??
          (busy
            ? text("sheetBusy")
            : text("sheetDraft"))
        }
      >
        {children}
      </Dialog>
    </PendingFormNavigationProvider>
  );
}

export function ListCreateSheet({
  canCreate = true,
  initialType,
}: {
  canCreate?: boolean;
  initialType?: ListTypeKey | null;
}) {
  const [busy, setBusy] = useState(false);
  const { locale } = useTranslation();
  const copy = listCreateMessages[locale];
  return (
    <FormSheet
      title={copy.sheetTitle}
      busy={busy}
      closeLabel={copy.closeLabel}
      description={busy ? copy.pendingDescription : copy.draftDescription}
    >
      <CreateListForm
        canCreate={canCreate}
        initialType={initialType}
        inSheet
        onBusyChange={setBusy}
      />
    </FormSheet>
  );
}

function ChoreSheet({
  edit = false,
  contextIdentity,
}: {
  edit?: boolean;
  contextIdentity?: { userId: string; familyId: string };
}) {
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"editing" | "unknown" | "confirmed">("editing");
  const { locale } = useTranslation();
  const copy = choreFormMessages[locale];
  return (
    <FormSheet
      title={edit ? copy.editTitle : copy.newTitle}
      busy={busy}
      closeLabel={copy.sheetCloseLabel}
      description={
        saveState !== "editing" ? "" : busy ? copy.sheetPendingDescription : copy.sheetDraftDescription
      }
    >
      {edit ? (
        <EditChoreForm
          contextIdentity={contextIdentity}
          inSheet
          onBusyChange={setBusy}
        />
      ) : (
        <CreateChoreForm inSheet onBusyChange={setBusy} onSaveStateChange={setSaveState} contextIdentity={contextIdentity} />
      )}
    </FormSheet>
  );
}

export function ChoreCreateSheet({ contextIdentity }: { contextIdentity?: { userId: string; familyId: string } } = {}) {
  return <ChoreSheet contextIdentity={contextIdentity} />;
}

export function ChoreEditSheet({
  contextIdentity,
}: { contextIdentity?: { userId: string; familyId: string } } = {}) {
  return <ChoreSheet edit contextIdentity={contextIdentity} />;
}
