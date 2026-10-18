"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { LargeHeader } from "@/components/ui/large-header";
import BoardSettings from "@/components/fridge/BoardSettings";
import DeleteAccountDialog from "@/components/account/DeleteAccountDialog";
import SettingsDisclosure from "@/app/dashboard/settings/SettingsDisclosure";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useFamilySettingsText } from "@/i18n/family-settings";

type State = "loading" | "ready" | "error" | "empty" | "forbidden";
export default function FamilySettingsPage() {
  const text = useFamilySettingsText();
  const [familyName, setFamilyName] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [state, setState] = useState<State>("loading");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const loadSequence = useRef(0);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  usePendingFormNavigationController(saving);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setState("loading");
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const body = await res.json();
      if (sequence !== loadSequence.current) return;
      if (
        !res.ok ||
        !body?.user ||
        !["parent", "teen", "child"].includes(body.user.role)
      )
        throw new Error();
      if (body.user.role !== "parent") {
        setState("forbidden");
        return;
      }
      if (body.user.family_id === null) {
        setState("empty");
        return;
      }
      if (
        typeof body.user.family_id !== "string" ||
        !body.user.family_id ||
        typeof body.user.family?.name !== "string"
      )
        throw new Error();
      setFamilyId(body.user.family_id);
      setFamilyName(body.user.family.name);
      setState("ready");
    } catch {
      if (sequence === loadSequence.current) setState("error");
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = familyName.trim();
    if (savingRef.current || state !== "ready" || !familyId || !name) return;
    savingRef.current = true;
    setSaving(true);
    setError(false);
    setSaved(false);
    try {
      const res = await fetch("/api/family", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyId, name }),
      });
      const body = await res.json();
      if (!res.ok || body?.family?.id !== familyId || body.family.name !== name)
        throw new Error();
      setFamilyName(body.family.name);
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-20">
      <LargeHeader title={text("title")} />
      {state === "loading" && <p role="status">{text("loading")}</p>}
      {state === "error" && (
        <div className="card-apple space-y-3 p-5" role="alert">
          <p>{text("loadFailed")}</p>
          <button
            type="button"
            className="btn-tinted min-h-[44px]"
            onClick={() => void load()}
          >
            {text("retry")}
          </button>
        </div>
      )}
      {state === "forbidden" && <p role="status">{text("parentOnly")}</p>}
      {state === "empty" && (
        <section className="card-apple space-y-3 p-5">
          <h2 className="text-title-3">{text("noFamily")}</h2>
          <p className="text-subhead text-label-secondary">
            {text("noFamilyHelp")}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/dashboard/family/create"
              className="btn-filled min-h-[44px]"
            >
              {text("create")}
            </Link>
            <Link href="/join" className="btn-tinted min-h-[44px]">
              {text("join")}
            </Link>
          </div>
        </section>
      )}
      {state === "ready" && (
        <>
          <form
            onSubmit={save}
            className="card-apple space-y-4 p-5"
            aria-busy={saving}
          >
            {error && (
              <p role="alert" className="text-[var(--danger-text)]">
                {text("failed")}
              </p>
            )}
            {saved && (
              <p role="status" className="text-success-text">
                {text("saved")}
              </p>
            )}
            <div>
              <label htmlFor="familyName" className="label-apple">
                {text("familyName")}
              </label>
              <input
                id="familyName"
                required
                maxLength={100}
                value={familyName}
                disabled={saving}
                onChange={(event) => {
                  setFamilyName(event.target.value);
                  setSaved(false);
                }}
                className="input-apple"
                placeholder={text("placeholder")}
              />
            </div>
            <button
              type="submit"
              disabled={saving || !familyName.trim()}
              className="btn-filled min-h-[44px]"
            >
              {text(saving ? "saving" : "save")}
            </button>
          </form>
          <SettingsDisclosure
            id="household-board"
            title={text("board")}
            description={text("boardHelp")}
          >
            <BoardSettings />
          </SettingsDisclosure>
          <SettingsDisclosure
            id="household-deletion"
            title={text("deletion")}
            description={text("deletionHelp")}
          >
            <button
              type="button"
              disabled={saving}
              onClick={() => setShowDeleteDialog(true)}
              className="btn-secondary min-h-[44px] text-[var(--danger-text)]"
            >
              {text("delete")}
            </button>
          </SettingsDisclosure>
          <DeleteAccountDialog
            open={showDeleteDialog}
            onClose={() => setShowDeleteDialog(false)}
          />
        </>
      )}
    </div>
  );
}
