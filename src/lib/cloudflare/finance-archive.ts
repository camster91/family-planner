/** Native D1 read adapters for import review and financial archive metadata.
 *
 * The archive is intentionally read-only.  It exposes bounded source
 * identity and a server-side payload fingerprint, never the archived JSON or
 * a money total.  Every read re-checks the current parent generation,
 * household and budget feature before touching archive rows.
 */
import { createHash } from "node:crypto";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  FINANCE_ARCHIVE_DETAIL_PROTOCOL,
  FINANCE_ARCHIVE_FINGERPRINT_BYTES,
  FINANCE_ARCHIVE_MODELS,
  FINANCE_ARCHIVE_PROTOCOL,
  financeArchiveDetails,
  financeArchivePage,
  type FinanceArchiveDetails,
  type FinanceArchiveModel,
} from "@/lib/finance-archive-contract";
import type { ArchivePaging } from "@/lib/finance-archive-read";
import { getD1Database, type D1Store } from "./database";
import { withD1ReadClient } from "./read-client";

export type D1FinanceArchiveActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

type NativeResult = { status: number; body: unknown };
const financeArchiveReviewEnabled = () => process.env.FINANCE_ARCHIVE_REVIEW_ENABLED === "1";

const unavailable = (status = 403, error = "Archive review is unavailable"): NativeResult => ({
  status,
  body: { code: error === "Archive review is unavailable" ? "UNAVAILABLE" : error },
});

function features(value: unknown) {
  if (typeof value !== "string") return normalizeFeatures(value);
  try { return normalizeFeatures(JSON.parse(value)); } catch { return normalizeFeatures({}); }
}

async function authorize(actor: D1FinanceArchiveActor, database?: D1Store): Promise<NativeResult | null> {
  if (!financeArchiveReviewEnabled()) return unavailable(404);
  if (actor.role !== "parent") return unavailable(403, "Forbidden");
  const current = await withD1ReadClient(async (db) => {
    const [user, family] = await Promise.all([
      db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
      db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
    ]);
    return { user, family };
  }, database as any);
  if (!current.user || current.user.family_id !== actor.familyId || current.user.role !== "parent" || current.user.token_version !== actor.generation)
    return unavailable(409, "OWNER_CHANGED");
  if (!current.family || !isFeatureEnabled(features(current.family.features), "budget")) return unavailable(404);
  return null;
}

function dateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function cursor(familyId: string, model: FinanceArchiveModel | null, row: { created_at: unknown; id: string }) {
  const date = dateValue(row.created_at);
  if (!date) throw new Error("Invalid archive timestamp");
  const tuple = [FINANCE_ARCHIVE_PROTOCOL, familyId, model, date.toISOString(), row.id];
  return Buffer.from(JSON.stringify(tuple), "utf8").toString("base64url");
}

function bounded(value: unknown, max: number) {
  const text = stringValue(value);
  return { value: text.slice(0, max), truncated: text.length > max };
}

export async function readD1FinanceArchivePage(
  actor: D1FinanceArchiveActor,
  page: ArchivePaging,
  database?: D1Store,
): Promise<NativeResult> {
  const denied = await authorize(actor, database);
  if (denied) return denied;
  const store = database ?? await getD1Database();
  const db = store.withSession("first-primary");
  const groups = await db.prepare(`SELECT source_model,COUNT(*) AS count FROM "FinancialArchiveRecord" WHERE family_id=?1 GROUP BY source_model`).bind(actor.familyId).all<any>();
  const known = new Set<string>(FINANCE_ARCHIVE_MODELS);
  const counts = [...FINANCE_ARCHIVE_MODELS, "other" as const].map((model) => ({
    model,
    count: String(groups.results
      .filter((row) => model === "other" ? !known.has(stringValue(row.source_model)) : row.source_model === model)
      .reduce((total, row) => total + Number(row.count ?? 0), 0)),
  }));

  const values: unknown[] = [actor.familyId];
  let where = `family_id=?1`;
  if (page.model === "other") {
    where += ` AND source_model NOT IN (${FINANCE_ARCHIVE_MODELS.map((_, index) => `?${index + 2}`).join(",")})`;
    values.push(...FINANCE_ARCHIVE_MODELS);
  } else if (page.model) {
    where += ` AND source_model=?${values.length + 1}`;
    values.push(page.model);
  }
  if (page.cursor) {
    where += ` AND (created_at<?${values.length + 1} OR (created_at=?${values.length + 1} AND id>?${values.length + 2}))`;
    values.push(page.cursor.createdAt.getTime(), page.cursor.createdAt.getTime(), page.cursor.id);
  }
  const rows = await db.prepare(`SELECT id,created_at,source_app,source_model,source_id FROM "FinancialArchiveRecord" WHERE ${where} ORDER BY created_at DESC,id ASC LIMIT 25`).bind(...values as any[]).all<any>();
  const visible = rows.results.slice(0, 24).map((row) => {
    const sourceApp = bounded(row.source_app, 80), sourceModel = bounded(row.source_model, 80), sourceId = bounded(row.source_id, 160);
    const createdAt = dateValue(row.created_at);
    if (!createdAt) throw new Error("Invalid archive timestamp");
    return { id: row.id, createdAt: createdAt.toISOString(), sourceApp: sourceApp.value, sourceModel: sourceModel.value, sourceId: sourceId.value, sourceLabelsTruncated: sourceApp.truncated || sourceModel.truncated || sourceId.truncated };
  });
  const body = financeArchivePage.parse({
    protocol: FINANCE_ARCHIVE_PROTOCOL,
    owner: { userId: actor.userId, familyId: actor.familyId, generation: actor.generation },
    model: page.model,
    counts,
    rows: visible,
    nextCursor: rows.results.length > 24 && visible.length ? cursor(actor.familyId, page.model, rows.results[23]) : null,
  });
  return { status: 200, body };
}

async function sha256Hex(value: string) {
  // node:crypto is available in local fixture workers; subtle keeps this
  // helper valid in the Cloudflare runtime as well.
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function readD1FinanceArchiveDetails(
  actor: D1FinanceArchiveActor,
  recordId: string,
  database?: D1Store,
): Promise<NativeResult> {
  const denied = await authorize(actor, database);
  if (denied) return denied;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(recordId)) return { status: 400, body: { code: "INVALID_PAGE" } };
  const store = database ?? await getD1Database();
  const db = store.withSession("first-primary");
  const row = await db.prepare(`SELECT payload FROM "FinancialArchiveRecord" WHERE family_id=?1 AND id=?2`).bind(actor.familyId, recordId).first<any>();
  if (!row) return { status: 404, body: { code: "RECORD_UNAVAILABLE" } };
  const bodyText = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload ?? null);
  const bytes = new TextEncoder().encode(bodyText).byteLength;
  const fingerprint = bytes > FINANCE_ARCHIVE_FINGERPRINT_BYTES
    ? { state: "too-large" as const, bytes, sha256: null }
    : bytes > 0
      ? { state: "available" as const, bytes, sha256: await sha256Hex(bodyText) }
      : { state: "unavailable" as const, bytes: null, sha256: null };
  const provenance = await db.prepare(`SELECT j.source_version,j.status,j.dry_run,j.id AS job_id FROM "FinancialArchiveRecord" a JOIN "ImportedRecord" i ON i.family_id=a.family_id AND i.source_app=a.source_app AND i.source_model=a.source_model AND i.source_id=a.source_id AND i.target_model='FinancialArchiveRecord' AND i.target_id=a.id LEFT JOIN "ImportJob" j ON j.id=i.import_job_id AND j.family_id=a.family_id AND j.source_app=a.source_app WHERE a.family_id=?1 AND a.id=?2 LIMIT 2`).bind(actor.familyId, recordId).all<any>();
  const matched = provenance.results.length === 1 && provenance.results[0].job_id && provenance.results[0].status === "completed" && !Number(provenance.results[0].dry_run);
  const sourceVersion = matched ? bounded(provenance.results[0].source_version, 80) : { value: "", truncated: false };
  const details: FinanceArchiveDetails = financeArchiveDetails.parse({
    protocol: FINANCE_ARCHIVE_DETAIL_PROTOCOL,
    owner: { userId: actor.userId, familyId: actor.familyId, generation: actor.generation },
    recordId,
    fingerprint,
    provenance: {
      state: provenance.results.length > 1 ? "ambiguous" : matched ? "matched" : "unavailable",
      sourceVersion: matched ? sourceVersion.value || null : null,
      versionTruncated: matched ? sourceVersion.truncated : false,
    },
  });
  return { status: 200, body: details };
}

export async function readD1ImportJobs(actor: D1FinanceArchiveActor, database?: D1Store): Promise<NativeResult> {
  if (actor.role !== "parent") return { status: 403, body: { error: "Parent access required" } };
  const current = await withD1ReadClient(async (db) => db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }), database as any);
  if (!current || current.family_id !== actor.familyId || current.role !== "parent" || current.token_version !== actor.generation)
    return { status: 401, body: { error: "Unauthorized" } };
  const store = database ?? await getD1Database();
  const rows = await store.withSession("first-primary").prepare(`SELECT id,source_app,source_version,status,dry_run,started_at,completed_at,summary,error FROM "ImportJob" WHERE family_id=?1 ORDER BY started_at DESC LIMIT 50`).bind(actor.familyId).all<any>();
  return { status: 200, body: { jobs: rows.results.map((row) => ({ ...row, dry_run: Number(row.dry_run) === 1, started_at: dateValue(row.started_at), completed_at: dateValue(row.completed_at), summary: typeof row.summary === "string" ? (() => { try { return JSON.parse(row.summary); } catch { return null; } })() : row.summary })) } };
}
