"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import {
  collectionResponse,
  recipeCurationResponse,
} from "@/lib/recipe-curation-contract";
import { useRecipeCurationText } from "@/i18n/recipe-curation";
import { RECIPE_OWNER_HEADER, readRecipeOwner, sameRecipeOwner, type RecipeOwner } from "@/lib/recipe-owner-contract";
import { requestRecipeCurationJson as requestOwnedJson } from "@/lib/recipe-curation-client";
type Current = {
  id: string;
  revision: number;
  favorite: boolean;
  collectionIds: string[];
};
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));
export function RecipeCuration({
  id,
  title,
  favorite = false,
  onChanged,
  expectedOwner,
  onOwnerHold,
}: {
  expectedOwner?: RecipeOwner;
  /** Mask the containing household view when this control loses its original owner. */
  onOwnerHold?: () => void;
  id: string;
  title: string;
  favorite?: boolean;
  onChanged?: () => void;
}) {
  const text = useRecipeCurationText();
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [base, setBase] = useState<Current | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [starred, setStarred] = useState(false);
  // Keep the compact trigger in sync with the last confirmed server value.
  // The parent list can refresh asynchronously after a save, so relying only
  // on the incoming prop leaves a newly-favorited recipe looking unstarred.
  const [savedFavorite, setSavedFavorite] = useState(favorite);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [message, setMessage] = useState<
    "readError" | "writeError" | "refreshed" | "saved" | "current" | "ownerChanged" | null
  >(null);
  const [ownerHold, setOwnerHold] = useState(false);
  const owner = useRef<RecipeOwner | null>(expectedOwner ?? null);
  const ownerHeld = useRef(false);
  const reloadFocus = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (ownerHold && document.activeElement === document.body) reloadFocus.current?.focus(); }, [ownerHold]);
  const holdOwner = () => {
    ownerHeld.current = true; setOwnerHold(true); setNeedsRefresh(true); setMessage("ownerChanged");
    onOwnerHold?.();
  };
  const generation = useRef(0);
  const action = useRef(false);
  const mutating = useRef(false);
  usePendingFormNavigationController(busy);
  useEffect(() => {
    setSavedFavorite(favorite);
  }, [id, favorite]);
  useEffect(() => {
    generation.current++;
    owner.current = expectedOwner ?? null;
    ownerHeld.current = false;
    setOwnerHold(false);
    action.current = false;
    mutating.current = false;
    setBusy(false);
    setLoading(false);
    setOpen(false);
    setBase(null);
    return () => {
      generation.current++;
      action.current = false;
    };
  }, [id, expectedOwner]);
  async function load(preserve: boolean) {
    if (ownerHeld.current) { setOpen(true); return; }
    if (action.current) return;
    action.current = true;
    const own = ++generation.current;
    setOpen(true);
    setLoading(true);
    setMessage(null);
    try {
      const init = owner.current ? { headers: { [RECIPE_OWNER_HEADER]: JSON.stringify(owner.current) } } : {};
      const [catalog, state] = await Promise.all([
        requestOwnedJson("/api/recipes/collections", init, 128 * 1024),
        requestOwnedJson(
          `/api/recipes/${encodeURIComponent(id)}/curation`,
          init,
          32 * 1024,
        ),
      ]);
      const retired = [catalog, state].some(result => result.kind === "reply" && (
        result.response.status === 401 || result.response.status === 403 ||
        (result.body as { error?: { code?: string } } | null)?.error?.code === "RECIPE_OWNER_CHANGED"));
      if (retired) { if (own === generation.current) holdOwner(); return; }
      if (
        catalog.kind !== "reply" ||
        state.kind !== "reply" ||
        !catalog.response.ok ||
        !state.response.ok
      )
        throw new Error();
      const catalogOwner = readRecipeOwner(catalog.response.headers?.get(RECIPE_OWNER_HEADER) ?? null);
      const stateOwner = readRecipeOwner(state.response.headers?.get(RECIPE_OWNER_HEADER) ?? null);
      if (!sameRecipeOwner(catalogOwner, stateOwner) || (owner.current && !sameRecipeOwner(owner.current, stateOwner))) {
        if (own === generation.current) holdOwner();
        return;
      }
      const c = collectionResponse.parse(catalog.body);
      const s = recipeCurationResponse.parse(state.body);
      if (s.id !== id) throw new Error();
      if (own !== generation.current) return;
      owner.current = stateOwner;
      setCollections(c.collections);
      setBase(s);
      setSavedFavorite(s.favorite);
      setNeedsRefresh(false);
      if (!preserve) {
        setChosen(s.collectionIds);
        setStarred(s.favorite);
      } else setMessage("refreshed");
    } catch {
      if (own === generation.current) {
        setNeedsRefresh(true);
        setMessage("readError");
      }
    } finally {
      if (own === generation.current) {
        action.current = false;
        setLoading(false);
      }
    }
  }
  async function save() {
    if (
      action.current ||
      ownerHeld.current || !owner.current ||
      !base ||
      needsRefresh ||
      chosen.length > 8 ||
      chosen.some((id) => !collections.some((c) => c.id === id))
    )
      return;
    if (base.favorite === starred && sameIds(base.collectionIds, chosen)) {
      setMessage("current");
      return;
    }
    action.current = true;
    mutating.current = true;
    const own = generation.current;
    setBusy(true);
    setMessage(null);
    const desired = {
      revision: base.revision,
      favorite: starred,
      collectionIds: [...chosen],
    };
    try {
      const response = await requestOwnedJson(
        `/api/recipes/${encodeURIComponent(id)}/curation`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", [RECIPE_OWNER_HEADER]: JSON.stringify(owner.current) },
          body: JSON.stringify(desired),
        },
        32 * 1024,
      );
      if (response.kind === "reply" && (
        response.response.status === 401 || response.response.status === 403 ||
        (response.body as { error?: { code?: string } } | null)?.error?.code === "RECIPE_OWNER_CHANGED" ||
        (response.response.ok && !sameRecipeOwner(owner.current, readRecipeOwner(response.response.headers?.get(RECIPE_OWNER_HEADER) ?? null)))
      )) { if (own === generation.current) holdOwner(); return; }
      if (response.kind !== "reply" || !response.response.ok) throw new Error();
      const result = recipeCurationResponse.parse(response.body);
      if (
        result.id !== id ||
        result.favorite !== desired.favorite ||
        !sameIds(result.collectionIds, desired.collectionIds)
      )
        throw new Error();
      if (own !== generation.current) return;
      setBase(result);
      setSavedFavorite(result.favorite);
      setMessage("saved");
      onChanged?.();
    } catch {
      if (own === generation.current) {
        setNeedsRefresh(true);
        setMessage("writeError");
      }
    } finally {
      if (own === generation.current) {
        action.current = false;
        setBusy(false);
        mutating.current = false;
      }
    }
  }
  const missing = chosen.filter((id) => !collections.some((c) => c.id === id));
  return (
    <>
      <button
        type="button"
        className="btn-tinted min-h-[44px]"
        aria-label={`${text.organize}: ${title}`}
        onClick={() => void load(false)}
      >
        {savedFavorite ? "★ " : ""}
        {text.organize}
      </button>
      <Dialog
        open={open}
        title={text.title}
        description={ownerHold ? text.ownerChanged : `${title}. ${text.help}`}
        variant="form"
        closeLabel={text.close}
        onClose={
          busy
            ? undefined
            : () => {
                if (mutating.current) return;
                generation.current++;
                action.current = false;
                setLoading(false);
                setOpen(false);
              }
        }
        footer={ownerHold ? null :
          <button
            type="button"
            className="btn-primary min-h-[44px] w-full"
            disabled={
              busy ||
              loading ||
              !base ||
              needsRefresh ||
              chosen.length > 8 ||
              missing.length > 0
            }
            onClick={() => void save()}
          >
            {busy ? text.saving : text.save}
          </button>
        }
      >
        {ownerHold ? <div role="alert" className="space-y-3"><p>{text.ownerChanged}</p>
          <button ref={reloadFocus} type="button" className="btn-secondary min-h-[44px]" onClick={() => window.location.reload()}>{text.reload}</button>
        </div> : <div className="space-y-3">
          {loading && <p role="status">{text.loading}</p>}
          {message && (
            <p
              role={
                message === "readError" || message === "writeError"
                  ? "alert"
                  : "status"
              }
            >
              {text[message]}
            </p>
          )}
          <button
            type="button"
            className="btn-secondary min-h-[44px]"
            disabled={loading || busy}
            onClick={() => void load(Boolean(base))}
          >
            {text.refresh}
          </button>
          <fieldset disabled={loading || busy || !base} className="space-y-2">
            <legend className="font-semibold">{text.collections}</legend>
            <label className="flex min-h-[44px] gap-3 items-center">
              <input
                type="checkbox"
                checked={starred}
                onChange={(event) => setStarred(event.target.checked)}
              />
              {text.favorite}
            </label>
            {!collections.length && <p>{text.empty}</p>}
            <div className="max-h-64 overflow-y-auto space-y-1">
              {[
                ...collections,
                ...missing.map((id) => ({ id, name: text.missing })),
              ].map((c) => (
                <label
                  key={c.id}
                  className="flex min-h-[44px] gap-3 items-center break-words"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(c.id)}
                    onChange={(event) =>
                      setChosen((previous) =>
                        event.target.checked
                          ? [...previous, c.id]
                          : previous.filter((id) => id !== c.id),
                      )
                    }
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          {chosen.length > 8 && <p role="alert">{text.limit}</p>}
          {missing.length > 0 && <p role="alert">{text.missingHelp}</p>}
        </div>}
      </Dialog>
    </>
  );
}
