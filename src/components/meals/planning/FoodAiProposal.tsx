"use client";
import * as React from "react";
import { foodAiLeaseCurrent } from "@/lib/food-planning/ai-evaluation";
import type { FoodAiSuggestion } from "@/lib/food-planning/ai-contract";
import { useFoodPlanningEntryText } from "@/i18n/food-planning-entry";
import { FoodPlanSummary } from "./FoodPlanSummary";
/** Read suggestions stay separate from editable choices and signed save review. */
export function FoodAiProposal({
  suggestion,
  busy,
  onUse,
  onDismiss,
}: {
  suggestion: FoodAiSuggestion;
  busy: boolean;
  onUse: () => void;
  onDismiss: () => void;
}) {
  const text = useFoodPlanningEntryText();
  const [leaseEnded, setLeaseEnded] = React.useState(false);
  React.useEffect(() => {
    setLeaseEnded(false);
    const timer = setTimeout(
      () => setLeaseEnded(true),
      Math.max(0, Date.parse(suggestion.original.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [suggestion.original.generatedAt, suggestion.original.expiresAt]);
  const expired = leaseEnded || !foodAiLeaseCurrent(suggestion.original);

  return (
    <section
      className="space-y-3"
      aria-label={text("aiChoices")}
    >
      <h3 className="font-semibold">
        {text("aiReview")}
      </h3>
      <p className="text-footnote text-label-secondary">
        {text("aiBoundary")}
      </p>
      <p role="status">
        {suggestion.evaluation.heldSlots
          ? text("heldChoices", { count: suggestion.evaluation.heldSlots })
          : text("noHolds")}
      </p>
      {expired && (
        <p role="status">
          {text("expired")}
        </p>
      )}
      <FoodPlanSummary
        plan={suggestion.proposal.plan}
        mode={suggestion.proposal.sourceRequest.plan.mode}
        timeZone={suggestion.proposal.sourceRequest.plan.timeZone}
        busy={busy}
      />
      <p className="text-footnote text-label-secondary">
        {text("useBoundary")}
      </p>
      {suggestion.feedbackTicket && (
        <p className="text-footnote text-label-secondary">
          {text("usageCounts")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-filled min-h-[44px]"
          disabled={busy || expired}
          onClick={onUse}
        >
          {text("useChoices")}
        </button>
        <button
          type="button"
          className="btn-secondary min-h-[44px]"
          disabled={busy}
          onClick={onDismiss}
        >
          {text("keepChoices")}
        </button>
      </div>
    </section>
  );
}
