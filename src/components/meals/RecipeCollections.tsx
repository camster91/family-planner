"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import {
  collectionResponse,
  recipeCollection,
  collectionName,
} from "@/lib/recipe-curation-contract";
import { useRecipeCurationText } from "@/i18n/recipe-curation";
import { requestRecipeCurationJson as requestOwnedJson } from "@/lib/recipe-curation-client";
import { RECIPE_OWNER_HEADER, readRecipeOwner, sameRecipeOwner, type RecipeOwner } from "@/lib/recipe-owner-contract";
type Collection = { id: string; name: string; revision: number };
export function RecipeCollections({
  value,
  onSelect,
  canEdit,
  expectedOwner,
  onOwnerHold,
}: {
  expectedOwner?: RecipeOwner;
  /** Mask the containing household view when this control loses its original owner. */
  onOwnerHold?: () => void;
  value: string;
  onSelect: (id: string) => void;
  canEdit: boolean;
}) {
  const text = useRecipeCurationText();
  const [rows, setRows] = useState<Collection[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState("");
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState<
    "readError" | "writeError" | "refreshed" | "saved" | null
  >(null);
  const [ownerHold, setOwnerHold] = useState(false);
  const owner = useRef<RecipeOwner | null>(expectedOwner ?? null);
  const ownerHeld = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const reloadFocus = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (ownerHold) reloadFocus.current?.focus(); }, [ownerHold]);
  const holdOwner = useCallback(() => {
    ownerHeld.current = true;
    setOwnerHold(true);
    setRows([]);
    setEditing("");
    setName("");
    setConfirm(false);
    setUncertain(true);
    onOwnerHold?.();
  }, [onOwnerHold]);
  const generation = useRef(0);
  const action = useRef(false);
  const mutating = useRef(false);
  const latestValue = useRef(value);
  latestValue.current = value;
  usePendingFormNavigationController(busy);
  const load = useCallback(async () => {
    if (action.current || ownerHeld.current) return;
    action.current = true;
    const own = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    try {
      const response = await requestOwnedJson(
        "/api/recipes/collections",
        { signal: abort.signal, ...(owner.current ? { headers: { [RECIPE_OWNER_HEADER]: JSON.stringify(owner.current) } } : {}) },
        128 * 1024,
      );
      if (own !== generation.current) return;
      if (response.kind === "reply" && (response.response.status === 401 || response.response.status === 403 ||
          (response.body as { error?: { code?: string } } | null)?.error?.code === "RECIPE_OWNER_CHANGED")) {
        holdOwner(); return;
      }
      if (response.kind !== "reply" || !response.response.ok) throw new Error();
      const receivedOwner = readRecipeOwner(response.response.headers?.get(RECIPE_OWNER_HEADER) ?? null);
      if (!receivedOwner || (owner.current && !sameRecipeOwner(owner.current, receivedOwner))) { holdOwner(); return; }
      const result = collectionResponse.parse(response.body);
      owner.current = receivedOwner;
      setRows(result.collections);
      setUncertain(false);
      setMessage("refreshed");
    } catch {
      if (own === generation.current) {
        setUncertain(true);
        setMessage("readError");
      }
    } finally {
      if (own === generation.current) {
        action.current = false;
        setLoading(false);
      }
    }
  }, [holdOwner]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      controller.current?.abort();
      action.current = false;
    };
  }, [load]);
  const selected = rows.find((row) => row.id === editing);
  async function write(remove = false) {
    if (action.current || ownerHeld.current || !owner.current || !["parent", "teen"].includes(owner.current.role)
        || uncertain || !canEdit || (editing && !selected))
      return;
    const parsed = collectionName.safeParse(name);
    if (!remove && !parsed.success) return;
    if (remove && !selected) return;
    const cleanName = parsed.success ? parsed.data : "";
    const input =
      remove && selected
        ? { action: "delete", id: selected.id, revision: selected.revision }
        : selected
          ? {
              action: "rename",
              id: selected.id,
              revision: selected.revision,
              name: cleanName,
            }
          : { action: "create", name: cleanName };
    action.current = true;
    mutating.current = true;
    const own = generation.current;
    const originalOwner = owner.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setMessage(null);
    try {
      const response = await requestOwnedJson(
        "/api/recipes/collections",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", [RECIPE_OWNER_HEADER]: JSON.stringify(originalOwner) },
          signal: abort.signal,
          body: JSON.stringify(input),
        },
        32 * 1024,
      );
      if (own !== generation.current) return;
      if (response.kind === "reply" && (response.response.status === 401 || response.response.status === 403 ||
          (response.body as { error?: { code?: string } } | null)?.error?.code === "RECIPE_OWNER_CHANGED" ||
          (response.response.ok && !sameRecipeOwner(originalOwner, readRecipeOwner(response.response.headers?.get(RECIPE_OWNER_HEADER) ?? null))))) {
        holdOwner(); return;
      }
      if (response.kind !== "reply" || !response.response.ok) throw new Error();
      const body = response.body as {
        deleted?: unknown;
        collection?: unknown;
      } | null;
      if (own !== generation.current) return;
      if (remove) {
        if (body?.deleted !== true || !selected) throw new Error();
        setRows((previous) => previous.filter((row) => row.id !== selected.id));
        if (latestValue.current === selected.id) onSelect("");
        setEditing("");
        setName("");
        setConfirm(false);
      } else {
        const result = recipeCollection.parse(body?.collection);
        if (selected && result.id !== selected.id) throw new Error();
        setRows((previous) =>
          [...previous.filter((row) => row.id !== result.id), result].sort(
            (a, b) => a.name.localeCompare(b.name),
          ),
        );
        setEditing(result.id);
        setName(result.name);
      }
      setMessage("saved");
    } catch {
      if (own === generation.current) {
        setUncertain(true);
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
  if (ownerHold) return (
    <div role="alert" className="space-y-2">
      <p>{text.ownerChanged}</p>
      <button ref={reloadFocus} type="button" className="btn-secondary min-h-[44px]" onClick={() => window.location.reload()}>{text.reload}</button>
    </div>
  );
  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span>{text.collections}</span>
        <select
          className="input-apple min-h-[44px]"
          value={value}
          disabled={loading || busy}
          onChange={(event) => {
            if (!action.current) onSelect(event.target.value);
          }}
        >
          <option value="">{text.all}</option>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
          {value && !rows.some((row) => row.id === value) && (
            <option value={value}>{text.missing}</option>
          )}
        </select>
      </label>
      {canEdit && owner.current && ["parent", "teen"].includes(owner.current.role) && (
        <button
          type="button"
          className="btn-tinted min-h-[44px]"
          onClick={() => {
            setOpen(true);
            setMessage(null);
            void load();
          }}
        >
          {text.manage}
        </button>
      )}
      {!open && message === "readError" && (
        <div role="alert">
          {text.readError}
          <button
            type="button"
            className="btn-plain min-h-[44px]"
            onClick={() => void load()}
          >
            {text.retry}
          </button>
        </div>
      )}
      <Dialog
        open={open && canEdit}
        title={text.manage}
        description={text.renameHint}
        variant="form"
        closeLabel={text.close}
        onClose={
          busy
            ? undefined
            : () => {
                if (mutating.current) return;
                setOpen(false);
                setConfirm(false);
              }
        }
      >
        <div className="space-y-3">
          {message && (
            <p role={message.endsWith("Error") ? "alert" : "status"}>
              {text[message]}
            </p>
          )}
          {loading && <p role="status">{text.loading}</p>}
          <button
            type="button"
            className="btn-secondary min-h-[44px]"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            {text.refresh}
          </button>
          <fieldset
            disabled={busy || loading || uncertain}
            className="space-y-3"
          >
            <label className="block space-y-1">
              {text.collections}
              <select
                className="input-apple min-h-[44px]"
                value={editing}
                onChange={(event) => {
                  const id = event.target.value;
                  setEditing(id);
                  setName(rows.find((row) => row.id === id)?.name ?? "");
                  setConfirm(false);
                }}
              >
                <option value="">{text.newCollection}</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
                {editing && !selected && (
                  <option value={editing}>{text.missing}</option>
                )}
              </select>
            </label>
            <label className="block space-y-1">
              {text.name}
              <input
                className="input-apple"
                maxLength={60}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary min-h-[44px]"
                disabled={!name.trim() || Boolean(editing && !selected)}
                onClick={() => void write()}
              >
                {selected ? text.rename : text.create}
              </button>
              {selected && (
                <button
                  type="button"
                  className="btn-plain min-h-[44px] text-[var(--danger-text)]"
                  onClick={() => setConfirm(true)}
                >
                  {text.remove}
                </button>
              )}
            </div>
            {confirm && (
              <div className="space-y-2">
                <p>
                  {text.removeHelp} <strong>{selected?.name}</strong>
                </p>
                <button
                  type="button"
                  className="btn-secondary min-h-[44px]"
                  onClick={() => setConfirm(false)}
                >
                  {text.cancel}
                </button>
                <button
                  type="button"
                  className="btn-primary min-h-[44px]"
                  onClick={() => void write(true)}
                >
                  {text.confirmRemove}
                </button>
              </div>
            )}
          </fieldset>
        </div>
      </Dialog>
    </div>
  );
}
