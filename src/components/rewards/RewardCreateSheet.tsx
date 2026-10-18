"use client";

import { useState } from "react";
import { FormSheet } from "@/components/layout/DashboardFormSheets";
import { FeatureGate } from "@/components/ui/feature-gate";
import { useTranslation } from "@/i18n";
import { rewardCreateMessages } from "@/i18n/reward-create";
import CreateRewardForm from "@/app/dashboard/rewards/create/CreateRewardForm";
import type { RewardCreateOwner } from "@/lib/reward-create-intent";

export function RewardCreateSheet({
  canCreate = false,
  owner,
}: {
  canCreate?: boolean;
  owner?: RewardCreateOwner;
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
          owner={owner}
          inSheet
          onBusyChange={setBusy}
        />
      </FormSheet>
    </FeatureGate>
  );
}
