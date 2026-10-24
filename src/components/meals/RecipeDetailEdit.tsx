"use client";

import * as React from "react";
import { useRecipeDetailText } from "@/i18n/recipe-detail";
import { Dialog } from "@/components/ui/dialog";
import { RecipeEditor } from "./RecipeEditor";
import type { RecipeDetailData } from "./RecipeDetail";

/** Uses the canonical recipe PATCH; editing never changes linked meal snapshots. */
export function RecipeDetailEdit({
  recipe,
  role,
  onSaved,
}: {
  recipe: RecipeDetailData;
  role: string | null;
  onSaved: (recipe: RecipeDetailData) => void;
}) {
  const text = useRecipeDetailText();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const savingRef = React.useRef(false);
  const close = () => {
    if (savingRef.current) return;
    setOpen(false);
  };
  const onSavingChange = (pending: boolean) => {
    // Own dismissal synchronously, before React commits the pending UI.
    savingRef.current = pending;
    setSaving(pending);
  };
  if (role !== "parent" && role !== "teen") return null;
  return (
    <>
      <button
        type="button"
        className="btn-tinted min-h-[44px]"
        onClick={() => setOpen(true)}
      >
        {text("edit")}
      </button>
      {open && (
        <Dialog
          open
          title={text("edit")}
          onClose={saving ? undefined : close}
          description={text("editDescription")}
        >
          <RecipeEditor
            initialRecipe={recipe}
            onSavingChange={onSavingChange}
            onSaved={(saved) => {
              onSaved(saved);
              setOpen(false);
            }}
            onCancel={close}
          />
        </Dialog>
      )}
    </>
  );
}
