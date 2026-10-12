"use client";

import { useState } from "react";
import { useTranslation } from "@/i18n";
import { allowanceCreateMessages } from "@/i18n/allowance-create";
import AllowanceCreateForm from "@/app/dashboard/allowance/create/AllowanceCreateForm";
import { FormSheet } from "./DashboardFormSheets";

/** Intercepted allowance creation keeps the dashboard mounted underneath. */
export function AllowanceCreateSheet({
  canCreate = true,
}: {
  canCreate?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const { locale } = useTranslation();
  const copy = allowanceCreateMessages[locale];

  return (
    <FormSheet
      title={copy.sheetTitle}
      busy={busy}
      closeLabel={copy.closeLabel}
      description={busy ? copy.pendingDescription : copy.draftDescription}
    >
      <AllowanceCreateForm
        canCreate={canCreate}
        inSheet
        onBusyChange={setBusy}
      />
    </FormSheet>
  );
}
