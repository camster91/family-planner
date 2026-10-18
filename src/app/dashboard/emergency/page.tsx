"use client";

import * as React from "react";
import { Heart, Plus, X, Trash2, Printer } from "lucide-react";
import { ListRow, InsetList, SectionHeader } from "@/components/ui/list-row";
import { FeatureGate } from "@/components/ui/feature-gate";
import { Dialog } from "@/components/ui/dialog";
import { usePendingFormNavigationController } from "@/components/layout/pending-form-navigation";
import { useEmergencyText } from "@/i18n/emergency";

interface EmergencyContact {
  id: string;
  person_id: string | null;
  person_name: string;
  relationship: string;
  blood_type: string | null;
  allergies: string | null;
  medications: string | null;
  medical_conditions: string | null;
  doctor_name: string | null;
  doctor_phone: string | null;
  dentist_name: string | null;
  dentist_phone: string | null;
  insurance_provider: string | null;
  insurance_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relation: string | null;
  notes: string | null;
}

interface ContactFormData {
  person_name: string;
  relationship: "self" | "child" | "spouse" | "parent" | "other";
  blood_type: string;
  allergies: string;
  medications: string;
  medical_conditions: string;
  doctor_name: string;
  doctor_phone: string;
  dentist_name: string;
  dentist_phone: string;
  insurance_provider: string;
  insurance_id: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relation: string;
  notes: string;
}

const RELATIONSHIPS = ["self", "child", "spouse", "parent", "other"] as const;

function emptyForm(): ContactFormData {
  return {
    person_name: "",
    relationship: "self",
    blood_type: "",
    allergies: "",
    medications: "",
    medical_conditions: "",
    doctor_name: "",
    doctor_phone: "",
    dentist_name: "",
    dentist_phone: "",
    insurance_provider: "",
    insurance_id: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    emergency_contact_relation: "",
    notes: "",
  };
}

function contactToForm(c: EmergencyContact): ContactFormData {
  return {
    person_name: c.person_name,
    relationship: c.relationship as ContactFormData["relationship"],
    blood_type: c.blood_type ?? "",
    allergies: c.allergies ?? "",
    medications: c.medications ?? "",
    medical_conditions: c.medical_conditions ?? "",
    doctor_name: c.doctor_name ?? "",
    doctor_phone: c.doctor_phone ?? "",
    dentist_name: c.dentist_name ?? "",
    dentist_phone: c.dentist_phone ?? "",
    insurance_provider: c.insurance_provider ?? "",
    insurance_id: c.insurance_id ?? "",
    emergency_contact_name: c.emergency_contact_name ?? "",
    emergency_contact_phone: c.emergency_contact_phone ?? "",
    emergency_contact_relation: c.emergency_contact_relation ?? "",
    notes: c.notes ?? "",
  };
}

function FormField({
  label,
  children,
}: {
  label: string;
  /** Render the control with the id the label points at. */
  children: (id: string) => React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-caption-1 text-label-secondary mb-1"
      >
        {label}
      </label>
      {children(id)}
    </div>
  );
}

function Input({
  value,
  onChange,
  className,
  inputRef,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
}) {
  return (
    <input
      {...props}
      ref={inputRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`min-h-11 w-full rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-body text-label-primary placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${className ?? ""}`}
    />
  );
}

type OptionalField = Exclude<
  keyof ContactFormData,
  "person_name" | "relationship" | "notes"
>;
const FORM_GROUPS: Array<{
  key: "medical" | "providers" | "contact";
  fields: Array<{ key: OptionalField; label: string; type?: "tel" }>;
}> = [
  {
    key: "medical",
    fields: [
      { key: "blood_type", label: "bloodType" },
      { key: "allergies", label: "allergies" },
      { key: "medications", label: "medications" },
      { key: "medical_conditions", label: "medicalConditions" },
    ],
  },
  {
    key: "providers",
    fields: [
      { key: "doctor_name", label: "doctorName" },
      { key: "doctor_phone", label: "doctorPhone", type: "tel" },
      { key: "dentist_name", label: "dentistName" },
      { key: "dentist_phone", label: "dentistPhone", type: "tel" },
      { key: "insurance_provider", label: "insuranceProvider" },
      { key: "insurance_id", label: "insuranceId" },
    ],
  },
  {
    key: "contact",
    fields: [
      { key: "emergency_contact_name", label: "emergencyContactName" },
      {
        key: "emergency_contact_phone",
        label: "emergencyContactPhone",
        type: "tel",
      },
      { key: "emergency_contact_relation", label: "emergencyContactRelation" },
    ],
  },
];

function isEmergencyContact(value: unknown): value is EmergencyContact {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !row.id ||
    typeof row.person_name !== "string" ||
    typeof row.relationship !== "string"
  )
    return false;
  return [
    "person_id",
    "notes",
    ...FORM_GROUPS.flatMap((group) => group.fields.map((field) => field.key)),
  ].every(
    (key) =>
      row[key] === undefined ||
      row[key] === null ||
      typeof row[key] === "string",
  );
}

function AddEditModal({
  initial,
  onSave,
  t,
  saving,
  error,
  formId,
  nameRef,
}: {
  initial?: EmergencyContact;
  onSave: (data: ContactFormData) => void;
  t: (key: string) => string;
  saving: boolean;
  error?: string | null;
  formId: string;
  nameRef: React.RefObject<HTMLInputElement>;
}) {
  const [form, setForm] = React.useState<ContactFormData>(
    initial ? contactToForm(initial) : emptyForm(),
  );
  const [nameError, setNameError] = React.useState(false);
  const set = (key: keyof ContactFormData, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "person_name") setNameError(false);
  };
  return (
    <form
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        if (!form.person_name.trim()) {
          setNameError(true);
          nameRef.current?.focus();
          return;
        }
        onSave(form);
      }}
    >
      {error && (
        <p role="alert" className="mb-4 text-footnote text-danger-text">
          {error}
        </p>
      )}
      <fieldset disabled={saving} className="space-y-4">
        <legend className="mb-3 text-body font-semibold">
          {t("emergency.groups.person")}
        </legend>
        <FormField label={t("emergency.personName")}>
          {(id) => (
            <>
              <Input
                id={id}
                inputRef={nameRef}
                required
                maxLength={200}
                aria-invalid={nameError || undefined}
                aria-describedby={nameError ? `${id}-error` : undefined}
                value={form.person_name}
                onChange={(value) => set("person_name", value)}
                placeholder={t("emergency.examples.personName")}
              />
              {nameError && (
                <p
                  id={`${id}-error`}
                  role="alert"
                  className="mt-1 text-footnote text-danger-text"
                >
                  {t("emergency.nameRequired")}
                </p>
              )}
            </>
          )}
        </FormField>
        <FormField label={t("emergency.relationship")}>
          {(id) => (
            <select
              id={id}
              value={form.relationship}
              onChange={(event) => set("relationship", event.target.value)}
              className="min-h-11 w-full rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-body text-label-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {RELATIONSHIPS.map((relationship) => (
                <option key={relationship} value={relationship}>
                  {t(`emergency.relationships.${relationship}`)}
                </option>
              ))}
            </select>
          )}
        </FormField>
      </fieldset>
      <p className="my-4 text-footnote text-label-secondary">
        {t("emergency.optionalSections")}
      </p>
      <div className="space-y-3">
        {FORM_GROUPS.map((group) => (
          <details
            key={group.key}
            className="rounded-xl border border-[var(--surface-separator)]"
          >
            <summary
              tabIndex={0}
              className="min-h-11 cursor-pointer rounded-xl px-3 py-3 text-body font-semibold text-label-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              {t(`emergency.groups.${group.key}`)}
            </summary>
            <fieldset disabled={saving} className="space-y-4 px-3 pb-4">
              <legend className="sr-only">
                {t(`emergency.groups.${group.key}`)}
              </legend>
              {group.fields.map((field) => (
                <FormField
                  key={field.key}
                  label={t(`emergency.${field.label}`)}
                >
                  {(id) => (
                    <Input
                      id={id}
                      type={field.type}
                      value={form[field.key]}
                      onChange={(value) => set(field.key, value)}
                      placeholder={t(`emergency.examples.${field.label}`)}
                    />
                  )}
                </FormField>
              ))}
              {group.key === "contact" && (
                <FormField label={t("emergency.notes")}>
                  {(id) => (
                    <textarea
                      id={id}
                      value={form.notes}
                      onChange={(event) => set("notes", event.target.value)}
                      rows={3}
                      placeholder={t("emergency.examples.notes")}
                      className="min-h-11 w-full resize-y rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-body text-label-primary placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                    />
                  )}
                </FormField>
              )}
            </fieldset>
          </details>
        ))}
      </div>
    </form>
  );
}

function FormActions({
  formId,
  saving,
  onDelete,
  t,
}: {
  formId: string;
  saving: boolean;
  onDelete?: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="flex gap-2">
      {onDelete && (
        <button
          type="button"
          disabled={saving}
          onClick={onDelete}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-subhead font-medium text-danger-text disabled:opacity-50"
        >
          <Trash2 size={16} aria-hidden="true" />
          {t("emergency.delete")}
        </button>
      )}
      <button
        type="submit"
        form={formId}
        disabled={saving}
        aria-busy={saving}
        className="ml-auto min-h-11 rounded-full bg-[var(--accent-fill)] px-4 py-2 text-subhead font-semibold text-white disabled:opacity-50"
      >
        {saving ? t("common.saving") : t("common.save")}
      </button>
    </div>
  );
}

// Print card for a single contact
function EmergencyCardPrint({
  contact,
  t,
}: {
  contact: EmergencyContact;
  t: (key: string) => string;
}) {
  const rel = contact.relationship as ContactFormData["relationship"];
  return (
    <div className="p-4 border-b border-[var(--surface-separator)] last:border-b-0">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-title-2 font-semibold text-label-primary">
            {contact.person_name}
          </h3>
          <p className="text-subhead text-label-secondary">
            {t(`emergency.relationships.${rel}`)}
          </p>
        </div>
        {contact.blood_type && (
          <span className="px-2 py-0.5 rounded-full bg-[var(--tint-family)] text-white text-caption-1 font-semibold">
            {contact.blood_type}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-footnote">
        {contact.allergies && (
          <div className="col-span-2">
            <span className="text-label-tertiary">
              {t("emergency.allergies")}:{" "}
            </span>
            <span className="text-label-primary font-medium">
              {contact.allergies}
            </span>
          </div>
        )}
        {contact.medications && (
          <div className="col-span-2">
            <span className="text-label-tertiary">
              {t("emergency.medications")}:{" "}
            </span>
            <span className="text-label-primary font-medium">
              {contact.medications}
            </span>
          </div>
        )}
        {contact.medical_conditions && (
          <div className="col-span-2">
            <span className="text-label-tertiary">
              {t("emergency.medicalConditions")}:{" "}
            </span>
            <span className="text-label-primary font-medium">
              {contact.medical_conditions}
            </span>
          </div>
        )}
        {contact.doctor_name && (
          <>
            <div>
              <span className="text-label-tertiary">
                {t("emergency.doctorName")}:{" "}
              </span>
              <span className="text-label-primary font-medium">
                {contact.doctor_name}
              </span>
            </div>
            {contact.doctor_phone && (
              <div>
                <span className="text-label-tertiary">
                  {t("emergency.doctorPhone")}:{" "}
                </span>
                <span className="text-label-primary font-medium">
                  {contact.doctor_phone}
                </span>
              </div>
            )}
          </>
        )}
        {contact.dentist_name && (
          <>
            <div>
              <span className="text-label-tertiary">
                {t("emergency.dentistName")}:{" "}
              </span>
              <span className="text-label-primary font-medium">
                {contact.dentist_name}
              </span>
            </div>
            {contact.dentist_phone && (
              <div>
                <span className="text-label-tertiary">
                  {t("emergency.dentistPhone")}:{" "}
                </span>
                <span className="text-label-primary font-medium">
                  {contact.dentist_phone}
                </span>
              </div>
            )}
          </>
        )}
        {contact.insurance_provider && (
          <>
            <div>
              <span className="text-label-tertiary">
                {t("emergency.insuranceProvider")}:{" "}
              </span>
              <span className="text-label-primary font-medium">
                {contact.insurance_provider}
              </span>
            </div>
            {contact.insurance_id && (
              <div>
                <span className="text-label-tertiary">
                  {t("emergency.insuranceId")}:{" "}
                </span>
                <span className="text-label-primary font-medium">
                  {contact.insurance_id}
                </span>
              </div>
            )}
          </>
        )}
        {contact.emergency_contact_name && (
          <div className="col-span-2">
            <span className="text-label-tertiary">
              {t("emergency.emergencyContactName")}:{" "}
            </span>
            <span className="text-label-primary font-medium">
              {contact.emergency_contact_name}
            </span>
            {contact.emergency_contact_relation && (
              <span className="text-label-tertiary">
                {" "}
                ({contact.emergency_contact_relation})
              </span>
            )}
            {contact.emergency_contact_phone && (
              <span className="text-label-tertiary">
                {" "}
                — {contact.emergency_contact_phone}
              </span>
            )}
          </div>
        )}
        {contact.notes && (
          <div className="col-span-2">
            <span className="text-label-tertiary">
              {t("emergency.notes")}:{" "}
            </span>
            <span className="text-label-primary font-medium">
              {contact.notes}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function EmergencyPage() {
  return (
    <FeatureGate featureKey="emergency">
      <EmergencyPageInner />
    </FeatureGate>
  );
}

function EmergencyPageInner() {
  const t = useEmergencyText();
  const [contacts, setContacts] = React.useState<EmergencyContact[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [modalError, setModalError] = React.useState<string | null>(null);
  const [showAdd, setShowAdd] = React.useState(false);
  // previewContact: the card shown on the right. editContact: the card open in the edit dialog.
  const [previewContact, setPreviewContact] =
    React.useState<EmergencyContact | null>(null);
  const [editContact, setEditContact] = React.useState<EmergencyContact | null>(
    null,
  );
  const [saving, setSaving] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const mutationInFlightRef = React.useRef(false);
  const formId = React.useId();
  const nameInputRef = React.useRef<HTMLInputElement>(null);
  const addButtonRef = React.useRef<HTMLButtonElement>(null);
  const contactsRevisionRef = React.useRef(0);
  const contactsReadRef = React.useRef(0);
  // Keep browser Back on this route while a contact mutation is in flight.
  // Dialog dismissal is disabled separately below so Escape/backdrop/close
  // cannot clear the draft before the server answers.
  usePendingFormNavigationController(saving);
  // D1 (#102): every member can read the cards (a child home alone must find
  // them); only parents can add, edit or delete. Unknown until /api/auth/me
  // answers, so the controls stay hidden rather than flash for a child.
  const [isParent, setIsParent] = React.useState(false);

  const [roleError, setRoleError] = React.useState(false);
  const [roleLoading, setRoleLoading] = React.useState(true);
  const roleReadRef = React.useRef(0);
  const fetchRole = React.useCallback(async () => {
    const read = ++roleReadRef.current;
    setRoleLoading(true);
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) throw new Error("Role unavailable");
      const data = await response.json();
      if (!["parent", "teen", "child"].includes(data?.user?.role))
        throw new Error("Role unavailable");
      if (read !== roleReadRef.current) return;
      setIsParent(data.user.role === "parent");
      setRoleError(false);
    } catch {
      if (read !== roleReadRef.current) return;
      setIsParent(false);
      setRoleError(true);
    } finally {
      if (read === roleReadRef.current) setRoleLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void fetchRole();
    return () => {
      roleReadRef.current += 1;
    };
  }, [fetchRole]);

  const fetchContacts = React.useCallback(
    async (background = false) => {
      const readId = ++contactsReadRef.current;
      const revision = contactsRevisionRef.current;
      const isCurrentRead = () =>
        readId === contactsReadRef.current &&
        revision === contactsRevisionRef.current;
      try {
        if (!background) setLoading(true);
        const res = await fetch("/api/emergency-contacts", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        if (!isCurrentRead()) return;
        if (
          !Array.isArray(data.contacts) ||
          !data.contacts.every(isEmergencyContact)
        )
          throw new Error("Invalid contacts response");
        const currentContacts: EmergencyContact[] = data.contacts;
        setContacts(currentContacts);
        setPreviewContact((current) =>
          current
            ? (currentContacts.find((contact) => contact.id === current.id) ??
              null)
            : null,
        );
        setError(null);
      } catch {
        if (!isCurrentRead()) return;
        setError(t("common.error"));
      } finally {
        if (isCurrentRead()) setLoading(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const handleSave = async (form: ContactFormData) => {
    if (!isParent || mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setSaving(true);
    setModalError(null);
    try {
      if (editContact) {
        const res = await fetch(`/api/emergency-contacts/${editContact.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error("Failed to update");
        contactsRevisionRef.current += 1;
        const edited = editContact;
        const data = (await res.json().catch(() => null)) as {
          contact?: EmergencyContact;
        } | null;
        const updated = data?.contact;
        if (isEmergencyContact(updated) && updated.id === edited.id) {
          setContacts((prev) =>
            prev.map((contact) =>
              contact.id === edited.id ? updated : contact,
            ),
          );
          setPreviewContact((prev) =>
            prev && prev.id === edited.id ? updated : prev,
          );
        }
      } else {
        const res = await fetch("/api/emergency-contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (!res.ok) throw new Error("Failed to create");
        contactsRevisionRef.current += 1;
        const data = (await res.json().catch(() => null)) as {
          contact?: EmergencyContact;
        } | null;
        if (isEmergencyContact(data?.contact))
          setContacts((prev) => [data.contact!, ...prev]);
      }
      setShowAdd(false);
      setEditContact(null);
      // The mutation is committed; release navigation and dismissal now. A
      // refresh is reconciliation only, so a slow GET cannot hold the draft
      // hostage. fetchContacts keeps the committed local result visible and
      // exposes a retryable page error when the refresh itself fails.
      setSaving(false);
      void fetchContacts(true);
    } catch {
      // Keep the modal open and say so.
      setModalError(t("common.error"));
    } finally {
      mutationInFlightRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isParent || !editContact || mutationInFlightRef.current) return;
    mutationInFlightRef.current = true;
    setSaving(true);
    setModalError(null);
    try {
      const res = await fetch(`/api/emergency-contacts/${editContact.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      contactsRevisionRef.current += 1;
      const deletedId = editContact.id;
      setContacts((prev) => prev.filter((contact) => contact.id !== deletedId));
      setEditContact(null);
      setShowDeleteConfirm(false);
      setPreviewContact(null);
      // Keep the committed deletion visible immediately; reconciliation must
      // not keep the pending-navigation latch armed while a GET hangs.
      setSaving(false);
      void fetchContacts(true);
      setTimeout(() => addButtonRef.current?.focus(), 0);
    } catch {
      setModalError(t("common.error"));
    } finally {
      mutationInFlightRef.current = false;
      setSaving(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const closeModal = () => {
    if (saving) return;
    setModalError(null);
    setShowAdd(false);
    setEditContact(null);
    setShowDeleteConfirm(false);
  };

  if (loading && contacts.length === 0 && !showAdd && !editContact) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-large-title font-display">
            {t("emergency.title")}
          </h1>
          <p className="text-subhead text-label-secondary mt-0.5">
            {t("emergency.subtitle")}
          </p>
        </div>
        <div className="card-apple p-8 text-center">
          <p className="text-subhead text-label-secondary">
            {t("common.loading")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Print-only styles */}
      <style jsx global>{`
        @media print {
          @page {
            margin: 0.5in;
            size: letter;
          }
          body * {
            visibility: hidden;
          }
          .print-card,
          .print-card * {
            visibility: visible;
          }
          .print-card {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="space-y-6 max-w-2xl mx-auto">
        {roleError && (
          <div
            role="alert"
            className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--surface-separator)] p-4"
          >
            <p className="text-subhead text-label-primary">
              {t("emergency.roleUnavailable")}
            </p>
            <button
              type="button"
              className="btn-tinted min-h-11"
              disabled={roleLoading}
              onClick={() => void fetchRole()}
            >
              {t("common.tryAgain")}
            </button>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--tint-rewards)] bg-[var(--tint-rewards)]/10 px-4 py-3"
          >
            <p className="text-subhead text-label-primary">{error}</p>
            <button
              type="button"
              onClick={() => void fetchContacts()}
              className="btn-ghost min-h-[44px] shrink-0 px-3"
            >
              {t("common.tryAgain")}
            </button>
          </div>
        )}
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between no-print">
          <div className="min-w-0 sm:flex-1">
            <h1 className="text-large-title font-display break-words">
              {t("emergency.title")}
            </h1>
            <p className="text-subhead text-label-secondary mt-0.5">
              {t("emergency.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {contacts.length > 0 && (
              <button
                type="button"
                onClick={handlePrint}
                className="flex min-h-[44px] items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--surface-fill)] text-label-primary text-subhead font-medium hover:bg-[var(--surface-fill-secondary)]"
              >
                <Printer className="w-4 h-4" />
                {t("emergency.print")}
              </button>
            )}
            {isParent && (
              <button
                ref={addButtonRef}
                onClick={() => setShowAdd(true)}
                className="flex min-h-[44px] min-w-[44px] items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-fill)] text-white text-subhead font-semibold"
              >
                <Plus className="w-4 h-4" />
                {t("emergency.addCard")}
              </button>
            )}
          </div>
        </div>

        {contacts.length === 0 ? (
          <div className="card-apple p-8 text-center">
            <Heart className="w-10 h-10 text-label-tertiary mx-auto mb-3" />
            <h2 className="text-title-3 text-label-primary">
              {t("emergency.empty")}
            </h2>
            <p className="text-subhead text-label-secondary mt-1">
              {t("emergency.emptySubtitle")}
            </p>
            {isParent && (
              <button
                onClick={() => setShowAdd(true)}
                className="mt-4 min-h-[44px] min-w-[44px] px-4 py-2 rounded-lg bg-[var(--accent-fill)] text-white text-subhead font-semibold"
              >
                {t("emergency.addCard")}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: list */}
            <div className="space-y-2">
              <SectionHeader>{t("emergency.title")}</SectionHeader>
              <InsetList>
                {contacts.map((c, i) => (
                  <ListRow
                    key={c.id}
                    icon={Heart}
                    glyphColor="family"
                    title={c.person_name}
                    subtitle={t(`emergency.relationships.${c.relationship}`)}
                    showChevron
                    last={i === contacts.length - 1}
                    onClick={() => setPreviewContact(c)}
                  />
                ))}
              </InsetList>
            </div>

            {/* Right: active card preview. Print shows the previewed card, or
                every card (the print-only block below) when none is previewed. */}
            <div
              className={previewContact ? "print-card" : undefined}
              data-testid="emergency-preview"
            >
              {previewContact ? (
                <div className="card-apple overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--surface-separator)] flex items-center justify-between no-print">
                    <p className="text-subhead font-semibold text-label-primary">
                      {previewContact.person_name}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPreviewContact(null)}
                      aria-label={t("emergency.closePreview")}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface-secondary)]"
                    >
                      <X
                        className="w-4 h-4 text-label-secondary"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <EmergencyCardPrint contact={previewContact} t={t} />
                  <div className="px-4 py-3 border-t border-[var(--surface-separator)] flex gap-2 no-print">
                    {isParent && (
                      <button
                        onClick={() => setEditContact(previewContact)}
                        className="px-3 py-1.5 rounded-lg bg-[var(--accent-fill)] text-white text-subhead font-semibold"
                      >
                        {t("emergency.editCard")}
                      </button>
                    )}
                    <button
                      onClick={handlePrint}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-fill)] text-label-primary text-subhead font-medium"
                    >
                      <Printer className="w-4 h-4" />
                      {t("emergency.print")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="card-apple p-8 text-center no-print">
                  <Heart className="w-8 h-8 text-label-tertiary mx-auto mb-2" />
                  <p className="text-subhead text-label-secondary">
                    {t("emergency.selectPreview")}
                  </p>
                </div>
              )}
            </div>

            {!previewContact && (
              <div
                className="print-card hidden print:block"
                data-testid="emergency-print-all"
              >
                {contacts.map((c) => (
                  <div key={c.id} className="break-inside-avoid">
                    <EmergencyCardPrint contact={c} t={t} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Short form sheets keep actions visible while optional sections scroll. */}
        <Dialog
          open={isParent && showAdd && !editContact}
          onClose={saving ? undefined : closeModal}
          title={t("emergency.addCard")}
          closeLabel={t("emergency.closeForm")}
          variant="form"
          initialFocusRef={nameInputRef}
          footer={<FormActions formId={formId} saving={saving} t={t} />}
        >
          <AddEditModal
            formId={formId}
            nameRef={nameInputRef}
            onSave={handleSave}
            t={t}
            saving={saving}
            error={modalError}
          />
        </Dialog>
        <Dialog
          open={isParent && !!editContact}
          onClose={saving ? undefined : closeModal}
          title={t("emergency.editCard")}
          closeLabel={t("emergency.closeForm")}
          variant="form"
          initialFocusRef={nameInputRef}
          footer={
            <FormActions
              formId={formId}
              saving={saving}
              t={t}
              onDelete={() => {
                setModalError(null);
                setShowDeleteConfirm(true);
              }}
            />
          }
        >
          {isParent && editContact && (
            <AddEditModal
              key={editContact.id}
              formId={formId}
              nameRef={nameInputRef}
              initial={editContact}
              onSave={handleSave}
              t={t}
              saving={saving}
              error={modalError}
            />
          )}
          <Dialog
            open={isParent && showDeleteConfirm && !!editContact}
            onClose={saving ? undefined : () => setShowDeleteConfirm(false)}
            title={t("emergency.deleteConfirmTitle")}
            description={t("emergency.deleteConfirmDescription")}
            closeLabel={t("emergency.closeDelete")}
            role="alertdialog"
          >
            <p className="break-words text-body font-semibold">
              {editContact?.person_name}
            </p>
            {modalError && (
              <p role="alert" className="mt-3 text-footnote text-danger-text">
                {modalError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                className="btn-plain min-h-11"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={saving}
                aria-busy={saving}
                className="min-h-11 rounded-full bg-danger-fill px-4 py-2 text-subhead font-semibold text-white disabled:opacity-50"
                onClick={() => void handleDelete()}
              >
                {saving ? t("common.saving") : t("emergency.delete")}
              </button>
            </div>
          </Dialog>
        </Dialog>
      </div>
    </>
  );
}
