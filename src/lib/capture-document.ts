/** Browser-safe review form adapters. Prompt/photo/provider bytes never enter
 * the local document; canonical requests are prepared only after confirmation.
 */
import { z } from "zod";
import { createEventSchema } from "@/lib/validations";
import { captureGrocerySchema } from "@/lib/capture-grocery-contract";
import { parseCalendarInstant } from "@/lib/calendar-planning/range";
import {
  captureEditableDocument,
  type ReviewDocumentPayload,
} from "@/lib/review-document-contract";
import type {
  CaptureTextReview,
  CaptureEventReview,
} from "@/lib/capture-review-contract";
export type CaptureEditableDocument = z.infer<typeof captureEditableDocument>;
export type CaptureReviewProvenance = ReviewDocumentPayload["provenance"];
export type CaptureEditableRow = CaptureEditableDocument["rows"][number];
export type CaptureFormText = CaptureTextReview & {
  clientId: string;
  quantity: string;
};
export type CaptureFormEvent = CaptureEventReview & { clientId: string };
export type CaptureRequestDraft = {
  action: "event.create" | "capture.grocery.add";
  body: string;
};

export function captureReviewDocument(
  draft: CaptureFormText | null,
  events: CaptureFormEvent[] | null,
  note: string | null,
): CaptureEditableDocument {
  const rows = draft
    ? [{ ...draft, quantity: draft.quantity }]
    : (events ?? []).map((event) => ({
        ...event,
        kind: "event" as const,
        quantity: "1",
        list_name: "",
      }));
  return captureEditableDocument.parse({
    domain: "capture",
    note: draft?.note ?? note ?? "",
    rows: rows.map((row) => ({
      clientId: row.clientId,
      kind: row.kind,
      title: row.title,
      startTime: row.start_time ?? "",
      endTime: row.end_time ?? "",
      location: row.location ?? "",
      eventType: row.event_type ?? "other",
      listName: row.list_name ?? "",
      quantity: row.quantity,
    })),
  });
}
/** A real ISO local time or explicit-offset instant. Do not accept Date's
 * natural-language parsing, calendar rollovers or normalized local DST gaps.
 */
export function captureReviewInstant(value: string): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(
      value,
    );
  if (!match) throw new Error("CAPTURE_INVALID_TIME");
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second ?? "00"}${fraction ? `.${fraction}` : ""}${zone ?? "Z"}`;
  const validated = parseCalendarInstant(normalized);
  if (zone) return validated.toISOString();
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== Number(year) ||
    date.getMonth() + 1 !== Number(month) ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute) ||
    date.getSeconds() !== Number(second ?? "0") ||
    date.getMilliseconds() !== Number((fraction ?? "").padEnd(3, "0"))
  )
    throw new Error("CAPTURE_INVALID_TIME");
  return date.toISOString();
}
export function captureDocumentUnknowns(
  document: CaptureEditableDocument,
): string[] {
  const values = new Set<string>();
  for (const row of document.rows) {
    if (!row.title.trim()) values.add("title");
    if (row.kind === "event" && !row.startTime) values.add("event-start");
    if (row.kind === "task") values.add("task-parent-review");
    if (row.kind === "listitem" && row.listName)
      values.add("suggested-list-destination");
    if (row.kind === "listitem" && !row.quantity.trim()) values.add("quantity");
  }
  return [...values];
}
export function captureRequestDrafts(
  document: CaptureEditableDocument,
): CaptureRequestDraft[] {
  const parsed = captureEditableDocument.parse(document);
  if (!parsed.rows.length) throw new Error("CAPTURE_EMPTY_REVIEW");
  return parsed.rows.map((row): CaptureRequestDraft => {
    if (row.kind === "task") throw new Error("CAPTURE_TASK_REVIEW_REQUIRED");
    if (row.kind === "listitem") {
      if (!/^[0-9]+$/.test(row.quantity.trim()))
        throw new Error("CAPTURE_INVALID_QUANTITY");
      const body = captureGrocerySchema.parse({
        content: row.title,
        quantity: Number(row.quantity),
      });
      return { action: "capture.grocery.add", body: JSON.stringify(body) };
    }
    const start = captureReviewInstant(row.startTime),
      end = row.endTime ? captureReviewInstant(row.endTime) : undefined;
    if (!start || (row.endTime && !end))
      throw new Error("CAPTURE_INVALID_TIME");
    const body = createEventSchema.strict().parse({
      title: row.title,
      start_time: start,
      ...(end ? { end_time: end } : {}),
      ...(row.location ? { location: row.location } : {}),
      event_type: row.eventType,
    });
    if (end && Date.parse(end) < Date.parse(start))
      throw new Error("CAPTURE_INVALID_TIME");
    return { action: "event.create", body: JSON.stringify(body) };
  });
}
