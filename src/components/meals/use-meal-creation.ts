"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import {
  mealCreateContext,
  mealCreateInput,
  mealCreateReceipt,
  type MealCreateInput,
} from "@/lib/meal-create-contract";
import { newIdempotencyKey } from "@/lib/idempotency-key";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
type Draft = Pick<
  MealCreateInput,
  | "date"
  | "meal_type"
  | "recipe_name"
  | "notes"
  | "cook_id"
  | "recipe_id"
  | "servings"
>;
export function useMealCreation(enabled: boolean, onCreated: () => void) {
  const { locale } = useTranslation();
  const es = locale === "es";
  const [context, setContext] = useState<{
    userId: string;
    familyId: string;
  } | null>(null);
  const [contextError, setContextError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flight = useRef(false);
  const pending = useRef<{ key: string; body: MealCreateInput } | null>(null);
  const unconfirmed = useRef(false);
  const navigation = usePendingFormNavigationController(busy || unknown);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 10000);
    setContextError(false);
    setContext(null);
    void (async () => {
      try {
        const response = await fetch("/api/meals/create", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error();
        const scope = mealCreateContext.parse(await response.json());
        if (active) setContext(scope);
      } catch {
        if (active) setContextError(true);
      } finally {
        clearTimeout(deadline);
      }
    })();
    return () => {
      active = false;
      clearTimeout(deadline);
      controller.abort();
    };
  }, [enabled, attempt]);
  async function save(draft?: Draft) {
    if (!enabled || flight.current) return;
    if (!pending.current) {
      if (!context || !draft) return;
      const parsed = mealCreateInput.safeParse({
        ...draft,
        protocol: "herewoven.meal-create.v1",
        issued_at: new Date().toISOString(),
        expected_user_id: context.userId,
        expected_family_id: context.familyId,
      });
      if (!parsed.success) {
        setError(
          es
            ? "Revisa el día, la receta y las porciones."
            : "Review the day, recipe and portions.",
        );
        return;
      }
      pending.current = { key: newIdempotencyKey(), body: parsed.data };
    }
    flight.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 15000);
    try {
      const intent = pending.current;
      const response = await fetch("/api/meals/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": intent.key,
        },
        body: JSON.stringify(intent.body),
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (response.ok) {
        if (!mealCreateReceipt.safeParse(payload).success) throw new Error();
        pending.current = null;
        unconfirmed.current = false;
        setUnknown(false);
        await navigation.releaseBeforeNavigation();
        onCreated();
        return;
      }
      const code =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "object" &&
        payload.error !== null &&
        "code" in payload.error
          ? payload.error.code
          : null;
      if (response.status >= 500 || code === "IDEMPOTENCY_IN_PROGRESS")
        throw new Error();
      if (code === "MEAL_NO_LONGER_AVAILABLE") {
        pending.current = null;
        unconfirmed.current = false;
        setUnknown(false);
      } else if (!unconfirmed.current) pending.current = null;
      const message =
        code === "AUTH_CONTEXT_CHANGED" ||
        response.status === 401 ||
        response.status === 403
          ? es
            ? "Cambió tu cuenta, hogar o permiso. El borrador se conserva; revisa tu sesión."
            : "Your account, household or permission changed. The draft is kept; review your session."
          : code === "MEAL_INTENT_EXPIRED"
            ? es
              ? "Este intento venció. Revisa las comidas guardadas antes de empezar otro."
              : "This save attempt expired. Review saved meals before starting another."
            : code === "MEAL_NO_LONGER_AVAILABLE"
              ? es
                ? "La comida confirmada ya no está disponible. Este reintento no la vuelve a crear."
                : "The confirmed meal is no longer available. This retry does not recreate it."
              : es
                ? "No se pudo confirmar el guardado. Revisa la receta, el cocinero y las porciones."
                : "The save could not be confirmed. Review the recipe, cook and portions.";
      const legacyReason =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error.slice(0, 200)
          : null;
      setError(legacyReason || message);
    } catch {
      unconfirmed.current = true;
      setUnknown(true);
      setError(
        es
          ? "No pudimos confirmar el guardado. Conserva el borrador y reintenta la misma solicitud para evitar duplicados."
          : "We could not confirm the save. Keep this draft and retry the same request to avoid duplicates.",
      );
    } finally {
      clearTimeout(deadline);
      flight.current = false;
      setBusy(false);
    }
  }
  return {
    save,
    retry: () => save(),
    busy,
    unknown,
    error,
    contextError,
    ready: !!context,
    contextKey: context ? `${context.userId}:${context.familyId}` : "",
    locked: busy || unknown,
    isPending: () => flight.current || pending.current !== null,
    reloadContext: () => setAttempt((value) => value + 1),
  };
}
