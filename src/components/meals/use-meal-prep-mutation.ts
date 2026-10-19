"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useBulkCookingText } from "@/i18n/bulk-cooking";

const id = z.string().min(1).max(128);
const result = z.union([
  z.object({
    sessionId: id,
    batchIds: z.array(id).max(8),
    mealIds: z.array(id).max(112),
  }),
  z.object({ batchId: id, mealIds: z.array(id).max(14) }),
  z.object({ sessionId: id }),
  z.object({ consumptionId: id }),
]);

/** A failed/ambiguous response retains the exact request, key and navigation lock. */
export function useMealPrepMutation(
  onSaved: (receipt: z.infer<typeof result>) => void,
  hookOptions: { freshWritesBlocked?: boolean } = {},
) {
  const tBulk = useBulkCookingText();
  const inFlight = useRef(false);
  const freshWritesBlocked = useRef(Boolean(hookOptions.freshWritesBlocked));
  const pending = useRef<{ key: string; body: object; url: string } | null>(
    null,
  );
  const unconfirmed = useRef(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const navigation = usePendingFormNavigationController(busy || unknown);
  freshWritesBlocked.current = Boolean(hookOptions.freshWritesBlocked);
  const save = async (
    body: object,
    url = "/api/meals/bulk/actions",
    requestOptions: { allowWhenFreshWritesBlocked?: boolean } = {},
  ) => {
    if (inFlight.current) return;
    if (
      freshWritesBlocked.current &&
      !requestOptions.allowWhenFreshWritesBlocked
    ) {
      return;
    }
    pending.current ??= {
      key: newIdempotencyKey(),
      body: JSON.parse(JSON.stringify(body)) as object,
      url,
    };
    inFlight.current = true;
    setBusy(true);
    setErrorCode(null);
    try {
      const intent = pending.current;
      const response = await fetch(intent.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": intent.key,
        },
        body: JSON.stringify(intent.body),
      });
      const payload: unknown = await response.json();
      if (response.ok) {
        const receipt = result.safeParse(payload);
        if (!receipt.success) throw new Error("Invalid receipt");
        pending.current = null;
        unconfirmed.current = false;
        setUnknown(false);
        await navigation.releaseBeforeNavigation();
        onSaved(receipt.data);
        return;
      }
      const parsed = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(payload);
      const code =
        response.status === 401
          ? "UNAUTHORIZED"
          : response.status === 403
            ? "PLANNER_FORBIDDEN"
            : parsed.success
              ? parsed.data.error.code
              : "INVALID_DRAFT";
      if (response.status >= 500 || code === "IDEMPOTENCY_IN_PROGRESS") {
        unconfirmed.current = true;
        setUnknown(true);
        setErrorCode("SAVE_UNCONFIRMED");
      } else {
        // A later refusal cannot prove that an earlier lost response did not
        // commit. Keep that original key/payload until its receipt is confirmed.
        if (!unconfirmed.current) {
          pending.current = null;
          setUnknown(false);
        }
        setErrorCode(code);
      }
    } catch {
      unconfirmed.current = true;
      setUnknown(true);
      setErrorCode("SAVE_UNCONFIRMED");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const error =
    errorCode === null
      ? null
      : errorCode === "SAVE_UNCONFIRMED"
        ? tBulk("unknown")
        : [
              "PLANNER_FORBIDDEN",
              "UNAUTHORIZED",
              "MEALS_DISABLED",
              "AUTH_CONTEXT_CHANGED",
            ].includes(errorCode)
          ? tBulk("forbidden")
          : ["BATCH_FULL", "STATE_CHANGED", "NOT_ENOUGH_PORTIONS"].includes(
                errorCode,
              )
            ? tBulk("changed")
            : errorCode === "PREP_NOT_READY"
              ? tBulk("needPrepared")
              : errorCode === "RECIPE_HISTORY_UNAVAILABLE"
                ? tBulk("recipeHistoryUnavailable")
                : errorCode === "BEFORE_PREPARATION"
                  ? tBulk("beforePrep")
                  : errorCode === "COOK_UNAVAILABLE"
                    ? tBulk("cookError")
                    : errorCode.endsWith("UNAVAILABLE")
                      ? tBulk("unavailable")
                      : tBulk("invalid");
  return {
    save,
    busy,
    unknown,
    locked: busy || unknown,
    error,
    isPending: () => inFlight.current || pending.current !== null,
    clearError: () => setErrorCode(null),
    retry: () =>
      pending.current &&
      save(pending.current.body, pending.current.url, {
        allowWhenFreshWritesBlocked: true,
      }),
  };
}
