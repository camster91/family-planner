"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import { RecipeDetail } from "@/components/meals/RecipeDetail";
import { useTranslation } from "@/i18n";
import { useRecipePresentationText } from "@/i18n/recipe-presentation";
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
  const text = useRecipePresentationText();
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
        {text("preparedUsed")}
      </button>
      <Dialog
        open={open}
        title={text("preparedTitle")}
        description={text("preparedDescription")}
        variant="form"
        closeLabel={text("close")}
        onClose={() => {
          generation.current++;
          request.current?.abort();
          setLoading(false);
          setOpen(false);
        }}
      >
        {loading && <p role="status">{text("preparedLoading")}</p>}
        {failed && (
          <div role="alert">
            <p>
              {text("preparedFailed")}
            </p>
            <button
              type="button"
              className="btn-secondary min-h-[44px]"
              onClick={() => void load()}
            >
              {text("retry")}
            </button>
          </div>
        )}
        {result?.state === "not-recorded" && (
          <p>
            {text("preparedNotRecorded")}
          </p>
        )}
        {result?.state === "not-prepared" && (
          <p>
            {text("preparedNotPrepared")}
          </p>
        )}
        {result?.state === "recorded" && (
          <>
            <p className="text-footnote text-label-secondary">
              {text("preparedRecordedAt", { date: new Date(result.capturedAt).toLocaleString(locale) })}
            </p>
            <RecipeDetail recipe={result.snapshot.recipe} />
          </>
        )}
      </Dialog>
    </>
  );
}
