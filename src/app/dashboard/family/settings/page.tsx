"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { LargeHeader } from "@/components/ui/large-header";
import BoardSettings from "@/components/fridge/BoardSettings";
import DeleteAccountDialog from "@/components/account/DeleteAccountDialog";
import TodayLayoutEditor from "@/components/fridge/TodayLayoutEditor";
import { TODAY_SECTIONS } from "@/lib/personal-layout";
import SettingsDisclosure from "@/app/dashboard/settings/SettingsDisclosure";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { requestOwnedJson } from "@/lib/owned-request-http";
import { useFamilySettingsText } from "@/i18n/family-settings";

type State = "loading" | "ready" | "error" | "empty" | "forbidden";
export default function FamilySettingsPage() {
  const text = useFamilySettingsText();
  const [familyName, setFamilyName] = useState("");
  const [familyId, setFamilyId] = useState("");
  const [baseName, setBaseName] = useState("");
  const [checking, setChecking] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const familyIdRef = useRef(familyId); familyIdRef.current = familyId;
  const loadController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>("loading");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const loadSequence = useRef(0);
  const [error, setError] = useState<"failed" | "changed" | "checkFailed" | null>(null);
  const [saved, setSaved] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  usePendingFormNavigationController(saving);
  const load = useCallback(async (preserve = false) => {
    if (savingRef.current) return;
    const sequence = ++loadSequence.current;
    const originalFamilyId = familyIdRef.current;
    loadController.current?.abort();
    const controller = new AbortController(); loadController.current = controller;
    if (preserve) setChecking(true); else setState("loading");
    try {
      const result = await requestOwnedJson("/api/auth/me", { signal: controller.signal }, 256 * 1024);
      if (sequence !== loadSequence.current) return;
      if (result.kind !== "reply") throw new Error();
      const res = result.response;
      const body = result.body as { user?: { role?: string; family_id?: string | null; family?: { name?: string } } } | null;
      if (!res.ok || !body?.user || !["parent", "teen", "child"].includes(body.user.role ?? "")) throw new Error();
      if (body.user.role !== "parent") { setState("forbidden"); return; }
      if (body.user.family_id === null) { setState("empty"); return; }
      if (typeof body.user.family_id !== "string" || !body.user.family_id || typeof body.user.family?.name !== "string") throw new Error();
      if (preserve && originalFamilyId !== body.user.family_id) { setState("forbidden"); return; }
      setFamilyId(body.user.family_id);
      setBaseName(body.user.family.name);
      if (!preserve) setFamilyName(body.user.family.name);
      setReviewed(preserve); setNeedsReview(false); setError(null); setSaved(false);
      setState("ready");
    } catch {
      if (sequence === loadSequence.current) {
        if (preserve) { setError("checkFailed"); setNeedsReview(true); }
        else setState("error");
      }
    } finally {
      if (loadController.current === controller) { loadController.current = null; setChecking(false); }
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      loadSequence.current++;
      loadController.current?.abort(); loadController.current = null;
      saveController.current?.abort(); saveController.current = null;
    };
  }, [load]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = familyName.trim();
    if (savingRef.current || loadController.current || checking || needsReview || state !== "ready" || !familyId || !name) return;
    savingRef.current = true; setSaving(true); setError(null); setSaved(false);
    const sequence = loadSequence.current;
    const controller = new AbortController(); saveController.current = controller;
    try {
      const result = await requestOwnedJson("/api/family/name", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ name_protocol: 1, familyId, name, baseName }),
      }, 64 * 1024);
      if (sequence !== loadSequence.current) return;
      if (result.kind !== "reply") throw new Error();
      const body = result.body as { code?: string; family?: { id?: string; name?: string } } | null;
      if (result.response.status === 409 && body?.code === "FAMILY_NAME_CHANGED") {
        setNeedsReview(true); setError("changed"); return;
      }
      if (!result.response.ok || body?.family?.id !== familyId || body.family.name !== name) throw new Error();
      setFamilyName(body.family.name); setBaseName(body.family.name); setReviewed(false); setSaved(true);
    } catch {
      if (sequence === loadSequence.current) setError("failed");
    } finally {
      if (saveController.current === controller) {
        saveController.current = null; savingRef.current = false; setSaving(false);
      }
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
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
                {text(error)}
              </p>
            )}
            {(error || needsReview) && <button type="button" className="btn-tinted min-h-[44px]"
              disabled={saving || checking} onClick={() => void load(true)}>{text(checking ? "checking" : "checkCurrent")}</button>}
            {reviewed && <p className="text-subhead text-label-secondary">{text("currentName")}: {baseName}</p>}
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
              disabled={saving || checking || needsReview || !familyName.trim()}
              className="btn-filled min-h-[44px]"
            >
              {text(saving ? "saving" : "save")}
            </button>
          </form>
          <TodayLayoutEditor
            scope="household"
            available={[...TODAY_SECTIONS]}
          />
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
