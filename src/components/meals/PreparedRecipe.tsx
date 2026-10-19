"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import { RecipeDetail } from "@/components/meals/RecipeDetail";
import { useTranslation } from "@/i18n";
import { mealRecipeSnapshot } from "@/lib/meal-recipe-history-contract";
const reply = z.discriminatedUnion("state", [
  z
    .object({
      batchId: z.string(),
      state: z.literal("recorded"),
      capturedAt: z.string().datetime(),
      snapshot: mealRecipeSnapshot,
    })
    .strict(),
  z
    .object({
      batchId: z.string(),
      state: z.enum(["not-prepared", "not-recorded"]),
    })
    .strict(),
]);
export function PreparedRecipe({ batchId }: { batchId: string }) {
  const { locale } = useTranslation();
  const es = locale === "es";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<z.infer<typeof reply> | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    generation.current++;
    setOpen(false);
    setResult(null);
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [batchId]);
  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const own = ++generation.current;
    setOpen(true);
    setLoading(true);
    setFailed(false);
    setResult(null);
    const deadline = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(
        `/api/meals/bulk/${encodeURIComponent(batchId)}/recipe`,
        { cache: "no-store", signal: controller.signal },
      );
      if (!response.ok) throw new Error();
      const parsed = reply.parse(await response.json());
      if (parsed.batchId !== batchId) throw new Error();
      if (own === generation.current) setResult(parsed);
    } catch {
      if (own === generation.current) setFailed(true);
    } finally {
      clearTimeout(deadline);
      if (own === generation.current) setLoading(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="btn-tinted min-h-[44px]"
        onClick={() => void load()}
      >
        {es ? "Receta usada" : "Recipe used"}
      </button>
      <Dialog
        open={open}
        title={
          es ? "Receta guardada al preparar" : "Recipe saved at preparation"
        }
        description={
          es
            ? "Detalles registrados al marcar la preparación como terminada. No cambian al editar la receta actual."
            : "Details recorded when prep was marked complete. Editing the current recipe does not change this record."
        }
        variant="form"
        closeLabel={es ? "Cerrar" : "Close"}
        onClose={() => {
          generation.current++;
          request.current?.abort();
          setLoading(false);
          setOpen(false);
        }}
      >
        {loading && <p role="status">{es ? "Cargando…" : "Loading…"}</p>}
        {failed && (
          <div role="alert">
            <p>
              {es
                ? "No pudimos leer este registro. Se conserva sin cambios."
                : "We could not read this record. It is kept unchanged."}
            </p>
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              onClick={() => void load()}
            >
              {es ? "Reintentar" : "Try again"}
            </button>
          </div>
        )}
        {result?.state === "not-recorded" && (
          <p>
            {es
              ? "No se registraron los detalles de la receta al preparar esta sesión. La receta actual puede haber cambiado."
              : "Recipe details were not recorded when this session was prepared. The current recipe may have changed."}
          </p>
        )}
        {result?.state === "not-prepared" && (
          <p>
            {es
              ? "Esta sesión aún no se ha marcado como preparada."
              : "This session has not been marked prepared yet."}
          </p>
        )}
        {result?.state === "recorded" && (
          <>
            <p className="text-footnote text-label-secondary">
              {es ? "Registrada" : "Recorded"}:{" "}
              {new Date(result.capturedAt).toLocaleString(locale)}
            </p>
            <RecipeDetail recipe={result.snapshot.recipe} />
          </>
        )}
      </Dialog>
    </>
  );
}
