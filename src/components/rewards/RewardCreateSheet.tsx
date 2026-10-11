"use client";

import { useState } from "react";
import { FormSheet } from "@/components/layout/DashboardFormSheets";
import { FeatureGate } from "@/components/ui/feature-gate";
import { useTranslation } from "@/i18n";
import { rewardCreateMessages } from "@/i18n/reward-create";
import CreateRewardForm from "@/app/dashboard/rewards/create/CreateRewardForm";

export function RewardCreateSheet({
  canCreate = false,
}: {
  canCreate?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const { locale } = useTranslation();
  const copy = rewardCreateMessages[locale];

  return (
    <FeatureGate featureKey="rewards">
      <FormSheet
        title={copy.sheetTitle}
        busy={busy}
        closeLabel={copy.closeLabel}
        description={busy ? copy.pendingDescription : copy.draftDescription}
      >
        <CreateRewardForm
          canCreate={canCreate}
          inSheet
          onBusyChange={setBusy}
        />
      </FormSheet>
    </FeatureGate>
  );
}
