"use client";

import { useState } from "react";
import { FormSheet } from "@/components/layout/DashboardFormSheets";
import CreateProjectForm from "@/app/dashboard/projects/create/CreateProjectForm";

export function ProjectCreateSheet() {
  const [busy, setBusy] = useState(false);

  return (
    <FormSheet title="New Project" busy={busy}>
      <CreateProjectForm inSheet onBusyChange={setBusy} />
    </FormSheet>
  );
}
