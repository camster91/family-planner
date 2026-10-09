"use client";

import { useEffect, useState } from "react";
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
  // Remount after dismissal so late downloads cannot reopen a closed dialog.
  return props.open ? <OpenDeleteAccountDialog {...props} /> : null;
}

function OpenDeleteAccountDialog(props: DeleteAccountDialogProps) {
  const [Controls, setControls] = useState<Awaited<
    ReturnType<typeof loadDeleteAccountDialog>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
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
  }, [attempt]);
  if (Controls) return <Controls {...props} />;
  return (
    <Dialog
      open
      onClose={props.onClose}
      title="Delete account"
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
