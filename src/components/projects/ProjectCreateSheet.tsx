"use client";

import { useState } from "react";
import { FormSheet } from "@/components/layout/DashboardFormSheets";
import CreateProjectForm from "@/app/dashboard/projects/create/CreateProjectForm";
import { useTranslation } from "@/i18n";
import { projectCreateMessages } from "@/i18n/project-create";

export function ProjectCreateSheet() {
  const [busy, setBusy] = useState(false);
  const { locale } = useTranslation();
  const copy = projectCreateMessages[locale];

  return (
    <FormSheet
      title={copy.sheetTitle}
      busy={busy}
      closeLabel={copy.closeLabel}
      description={busy ? copy.pendingDescription : copy.draftDescription}
    >
      <CreateProjectForm inSheet onBusyChange={setBusy} />
    </FormSheet>
  );
}
