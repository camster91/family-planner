"use client";

// "Add task" for an existing project (route inventory F-5, #289): the in-app
// caller of POST /api/projects/[id]/tasks. Shown on an active project only
// (the API refuses completed and archived ones). Any household member may add
// a task, like the API.
//
// Online only: offline the button stays but the form says so and does not
// send. A failed save keeps what was typed and shows the server's reason.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useOnline } from "@/components/ui/use-online";
import { useToast } from "@/components/ui/toast";
import { useProjectOverviewText } from "@/i18n/project-overview";
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";
import { canonicalBodySignature } from "@/lib/request-signature";

interface AddProjectTaskFormProps {
  projectId: string;
  familyMembers?: { id: string; name: string }[];
}

const FOCUS =
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]";

export function AddProjectTaskForm({
  projectId,
  familyMembers = [],
}: AddProjectTaskFormProps) {
  const router = useRouter();
  const online = useOnline();
  const { addToast } = useToast();
  const text = useProjectOverviewText();
  const idBase = React.useId();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [assignee, setAssignee] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const currentRequest = React.useRef<{
    key: string;
    signature: string;
  } | null>(null);
  const ambiguousRequests = React.useRef(new Map<string, string>());
  const titleRef = React.useRef<HTMLInputElement>(null);
  const openerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  const close = () => {
    if (saving) return;
    setOpen(false);
    setTitle("");
    setDueDate("");
    setAssignee("");
    setError(null);
    // Back to the button that opened the form, so keyboard focus is not lost.
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError(text("taskNameRequired"));
      titleRef.current?.focus();
      return;
    }
    if (!online || saving) return;
    setSaving(true);
    setError(null);
    const body = {
      title: trimmed,
      ...(dueDate ? { due_date: dueDate } : {}),
      ...(assignee ? { assigned_to: assignee } : {}),
    };
    const signature = canonicalBodySignature(body);
    const key =
      currentRequest.current?.signature === signature
        ? currentRequest.current.key
        : (ambiguousRequests.current.get(signature) ?? newIdempotencyKey());
    currentRequest.current = { key, signature };

    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/tasks`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [IDEMPOTENCY_HEADER]: key,
          },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (
        !res.ok ||
        !data?.task ||
        typeof data.task.id !== "string" ||
        typeof data.task.title !== "string"
      ) {
        const code =
          data?.error && typeof data.error === "object"
            ? data.error.code
            : undefined;
        const retryableInProgress =
          res.status === 409 && code === "IDEMPOTENCY_IN_PROGRESS";
        if (
          res.status >= 500 ||
          (res.status >= 200 && res.status < 300) ||
          retryableInProgress
        ) {
          ambiguousRequests.current.set(signature, key);
        } else {
          ambiguousRequests.current.delete(signature);
          currentRequest.current = null;
        }
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : typeof data?.error?.message === "string"
              ? data.error.message
              : text("taskUpdateFallback"),
        );
      }
      ambiguousRequests.current.delete(signature);
      currentRequest.current = null;
      setTitle("");
      setDueDate("");
      setAssignee("");
      addToast({
        type: "success",
        title: text("taskAdded"),
        message: text("taskAddedMessage", { name: data.task.title }),
      });
      router.refresh();
      titleRef.current?.focus();
    } catch (err) {
      if (err instanceof TypeError)
        ambiguousRequests.current.set(signature, key);
      setError(
        `${text("taskAddError")} ${err instanceof Error ? err.message : text("taskUpdateFallback")}`,
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary ${FOCUS}`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {text("addTask")}
      </button>
    );
  }

  const titleId = `${idBase}-title`;
  const dueId = `${idBase}-due`;
  const assigneeId = `${idBase}-assignee`;
  const errorId = `${idBase}-error`;

  return (
    <form
      onSubmit={submit}
      aria-label={text("taskFormLabel")}
      aria-busy={saving || undefined}
      className="card-apple space-y-3 p-4"
      noValidate
    >
      {!online && (
        <p
          role="status"
          className="rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-3 py-2 text-[15px] text-label-primary"
        >
          {text("offline")}
        </p>
      )}

      <fieldset disabled={saving} className="space-y-3">
        <div>
          <label
            htmlFor={titleId}
            className="block text-[15px] font-medium text-label-primary"
          >
            {text("taskName")}
          </label>
          <input
            ref={titleRef}
            id={titleId}
            type="text"
            value={title}
            maxLength={200}
            required
            aria-invalid={error && !title.trim() ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setTitle(e.target.value)}
            className={`mt-1 min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--surface-separator)] bg-transparent px-3 text-[16px] text-label-primary ${FOCUS}`}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor={dueId}
              className="block text-[15px] font-medium text-label-primary"
            >
              {text("dueDate")}{" "}
              <span className="font-normal text-label-secondary">
                {text("optional")}
              </span>
            </label>
            <input
              id={dueId}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={`mt-1 min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--surface-separator)] bg-transparent px-3 text-[16px] text-label-primary ${FOCUS}`}
            />
          </div>
          {familyMembers.length > 0 && (
            <div>
              <label
                htmlFor={assigneeId}
                className="block text-[15px] font-medium text-label-primary"
              >
                {text("whoIsDoingIt")}{" "}
                <span className="font-normal text-label-secondary">
                  {text("optional")}
                </span>
              </label>
              <select
                id={assigneeId}
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className={`mt-1 min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--surface-separator)] bg-transparent px-3 text-[16px] text-label-primary ${FOCUS}`}
              >
                <option value="">{text("anyone")}</option>
                {familyMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-[15px] text-danger-text">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={!online || saving}
            aria-busy={saving ? true : undefined}
            className={`inline-flex min-h-[44px] min-w-[44px] items-center rounded-full bg-tint-projects px-5 text-[15px] font-medium text-white disabled:opacity-60 ${FOCUS}`}
          >
            {saving ? text("addingTask") : text("addTask")}
          </button>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            className={`inline-flex min-h-[44px] min-w-[44px] items-center rounded-full bg-[var(--surface-fill)] px-5 text-[15px] font-medium text-label-primary disabled:opacity-60 ${FOCUS}`}
          >
            {text("done")}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
