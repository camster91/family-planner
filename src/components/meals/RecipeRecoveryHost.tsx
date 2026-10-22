"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RecipeEditor } from "./RecipeEditor";
import { useRecipeEditorText } from "@/i18n/recipe-editor";

/** No import/provider call or alternate editor. Exact local work is opened by
 * the canonical owned recipe boundary, including its paused recovery controls.
 */
export function RecipeRecoveryHost({
  identity,
}: {
  identity: { userId: string; familyId: string };
}) {
  const router = useRouter(),
    text = useRecipeEditorText(),
    headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6"
    >
      <header>
        <h1 id={headingId} className="text-title-1">
          {text("draftReviewTitle")}
        </h1>
        <p className="mt-2 text-body text-label-secondary">
          {text("draftReviewHint")}
        </p>
      </header>
      <RecipeEditor
        key={`${identity.userId}:${identity.familyId}`}
        recoveryIdentity={identity}
        recoveryOnly
        onCancel={() => router.push("/dashboard/meals/explore")}
        onCreated={(recipe) =>
          router.push(
            `/dashboard/meals/recipes/${encodeURIComponent(recipe.id)}`,
          )
        }
      />
      <Link className="btn-plain min-h-11" href="/dashboard/meals/explore">
        {text("draftRecipeBox")}
      </Link>
    </section>
  );
}
