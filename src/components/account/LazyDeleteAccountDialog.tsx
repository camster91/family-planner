"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import {
  accountDeletionStatusMessages,
  type AccountDeletionStatusMessage,
} from "@/i18n/account-deletion-status";
import type { DeleteAccountDialogProps } from "./DeleteAccountDialog";
import { loadDeleteAccountDialog } from "./load-delete-account-dialog";
import { Dialog } from "@/components/ui/dialog";
import {
  AccountDeletionLoading,
  AccountDeletionFailure,
} from "./AccountDeletionStatus";

/** Keep destructive account controls out of startup; never perform a mutation while loading. */
export default function LazyDeleteAccountDialog(
  props: DeleteAccountDialogProps,
) {
  const { t } = useTranslation();
  const msg = (key: AccountDeletionStatusMessage) =>
    t(key, undefined, accountDeletionStatusMessages);
  const [Controls, setControls] = useState<Awaited<
    ReturnType<typeof loadDeleteAccountDialog>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!props.open || Controls) return;
    let active = true;
    setFailed(false);
    void loadDeleteAccountDialog()
      .then((Loaded) => {
        if (active) setControls(() => Loaded);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [attempt, props.open, Controls]);
  // Keep loaded controls mounted while closed: their uncertain mutation retry
  // key must survive dismissal, exactly as in the original eager dialog.
  if (Controls) return <Controls {...props} />;
  if (!props.open) return null;
  return (
    <Dialog
      open
      onClose={props.onClose}
      title={msg("accountTitle")}
      closeLabel={msg("close")}
      testId="delete-account-dialog"
    >
      {failed ? (
        <AccountDeletionFailure
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : (
        <AccountDeletionLoading />
      )}
    </Dialog>
  );
}
