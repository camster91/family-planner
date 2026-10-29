/** Native D1 health and emergency records.
 *
 * Medical records have stricter visibility than ordinary family features:
 * children and teens can read their own records, report themselves sick, and
 * log their own medication dose; parents manage household records. Every
 * operation checks the current session generation, membership and feature at
 * the D1 boundary.
 */
import { randomUUID } from "node:crypto";
import type { EffectResult } from "@/lib/idempotency";
import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import { isKidRole } from "@/lib/kid-access";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import { withD1ReadClient, type D1ReadClient } from "./read-client";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";

export type D1HealthActor = AssistantProofActor;
type NativeResult = EffectResult;
type HealthFeature = "emergency" | "sick-days";

const failure = (status: number, error: string): EffectResult => ({ status, body: { error } });
const parentOnly = (): EffectResult => failure(403, "Parents only");
const parentsOnly = (): EffectResult => failure(403, "Parents only");

function dateValue(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function epoch(value: unknown): number {
  const date = dateValue(value);
  if (!date) throw new Error("Invalid health timestamp");
  return date.getTime();
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try { return JSON.parse(value); } catch { return null; }
}

function features(value: unknown) {
  if (typeof value === "string") {
    try { return normalizeFeatures(JSON.parse(value)); } catch { return normalizeFeatures({}); }
  }
  return normalizeFeatures(value);
}

async function authority(db: D1ReadClient, actor: D1HealthActor, feature: HealthFeature, parent = false): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ]);
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation)
    return failure(401, "Unauthorized");
  if (parent && user.role !== "parent") return parentOnly();
  if (!family || !isFeatureEnabled(features(family.features), feature)) return failure(403, "This feature is turned off for your family");
  return null;
}

async function readAuthority(actor: D1HealthActor, feature: HealthFeature, parent = false, database?: D1Store) {
  const store = database ?? await getD1Database();
  return { store, denied: await withD1ReadClient((db) => authority(db, actor, feature, parent), store as any) };
}

function contactDto(row: any) {
  return {
    id: row.id, family_id: row.family_id, person_id: row.person_id ?? null,
    person_name: row.person_name, relationship: row.relationship,
    blood_type: row.blood_type ?? null, allergies: row.allergies ?? null,
    medications: row.medications ?? null, medical_conditions: row.medical_conditions ?? null,
    doctor_name: row.doctor_name ?? null, doctor_phone: row.doctor_phone ?? null,
    dentist_name: row.dentist_name ?? null, dentist_phone: row.dentist_phone ?? null,
    insurance_provider: row.insurance_provider ?? null, insurance_id: row.insurance_id ?? null,
    emergency_contact_name: row.emergency_contact_name ?? null,
    emergency_contact_phone: row.emergency_contact_phone ?? null,
    emergency_contact_relation: row.emergency_contact_relation ?? null,
    notes: row.notes ?? null, created_at: dateValue(row.created_at), updated_at: dateValue(row.updated_at),
  };
}

function medicationDto(row: any) {
  return {
    id: row.id, sick_day_id: row.sick_day_id ?? null, family_id: row.family_id,
    person_id: row.person_id, name: row.name, dosage: row.dosage, schedule: row.schedule,
    next_dose_at: dateValue(row.next_dose_at), last_dose_at: dateValue(row.last_dose_at),
    active: Number(row.active) === 1 || row.active === true, notes: row.notes ?? null,
    created_by: row.created_by, created_at: dateValue(row.created_at), updated_at: dateValue(row.updated_at),
  };
}

function sickDayDto(row: any) {
  return {
    id: row.id, family_id: row.family_id, person_id: row.person_id,
    started_at: dateValue(row.started_at), ended_at: dateValue(row.ended_at),
    symptoms: row.symptoms ?? null, severity: row.severity, status: row.status,
    temperature_log: jsonValue(row.temperature_log), notes: row.notes ?? null,
    created_by: row.created_by, created_at: dateValue(row.created_at), updated_at: dateValue(row.updated_at),
  };
}

export async function readD1EmergencyContacts(actor: D1HealthActor, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "emergency", false, database);
  if (denied) return denied;
  const rows = await store.withSession("first-primary").prepare(`SELECT * FROM "EmergencyContact" WHERE family_id=?1 ORDER BY created_at DESC`).bind(actor.familyId).all<any>();
  return { status: 200, body: { contacts: rows.results.map(contactDto) } };
}

export async function createD1EmergencyContact(actor: D1HealthActor, input: any, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "emergency", true, database);
  if (denied) return denied;
  const db = store.withSession("first-primary");
  if (input.person_id && !(await db.prepare(`SELECT id FROM "User" WHERE id=?1 AND family_id=?2`).bind(input.person_id, actor.familyId).first())) return failure(400, "Person not in your family");
  const now = new Date(), id = randomUUID();
  const fields = ["person_id", "person_name", "relationship", "blood_type", "allergies", "medications", "medical_conditions", "doctor_name", "doctor_phone", "dentist_name", "dentist_phone", "insurance_provider", "insurance_id", "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation", "notes"] as const;
  const values = fields.map(field => input[field] ?? null);
  const columns = fields.join(",");
  const placeholders = fields.map((_, index) => `?${index + 3}`).join(",");
  let result: Awaited<ReturnType<typeof db.batch>>;
  try {
    result = await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      db.prepare(`INSERT INTO "EmergencyContact" (id,family_id,${columns},created_at,updated_at) VALUES (?1,?2,${placeholders},?${fields.length + 3},?${fields.length + 3}) RETURNING *`).bind(id, actor.familyId, ...values, now.getTime()),
    ]);
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    const current = await readAuthority(actor, "emergency", true, database);
    return current.denied ?? failure(409, "Unable to create emergency contact");
  }
  const row = result[1]?.results?.[0] as any;
  if (!row) return failure(409, "Unable to create emergency contact");
  return { status: 201, body: { contact: contactDto(row) } };
}

const CONTACT_FIELDS = ["person_id", "person_name", "relationship", "blood_type", "allergies", "medications", "medical_conditions", "doctor_name", "doctor_phone", "dentist_name", "dentist_phone", "insurance_provider", "insurance_id", "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation", "notes"] as const;

export async function updateD1EmergencyContact(actor: D1HealthActor, id: string, input: any, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "emergency", true, database);
  if (denied) return denied;
  const db = store.withSession("first-primary");
  const existing = await db.prepare(`SELECT * FROM "EmergencyContact" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId).first<any>();
  if (!existing) return failure(404, "Not found");
  if (input.person_id && !(await db.prepare(`SELECT id FROM "User" WHERE id=?1 AND family_id=?2`).bind(input.person_id, actor.familyId).first())) return failure(400, "Person not in your family");
  const sent = CONTACT_FIELDS.filter(field => input[field] !== undefined);
  if (!sent.length) return { status: 200, body: { contact: contactDto(existing) } };
  const now = new Date(Math.max(Date.now(), epoch(existing.updated_at) + 1));
  const assignments = sent.map((field, index) => `${field}=?${index + 3}`).join(",");
  const values = sent.map(field => input[field]);
  try {
    const result = await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "EmergencyContact" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
      db.prepare(`UPDATE "EmergencyContact" SET ${assignments},updated_at=?${sent.length + 3} WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId, ...values, now.getTime()),
      db.prepare(`SELECT * FROM "EmergencyContact" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId),
    ]);
    const updated = result[3]?.results?.[0] as any;
    return { status: 200, body: { contact: contactDto(updated) } };
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    return failure(404, "Not found");
  }
}

export async function deleteD1EmergencyContact(actor: D1HealthActor, id: string, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "emergency", true, database);
  if (denied) return denied;
  const db = store.withSession("first-primary");
  try {
    await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "EmergencyContact" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
      db.prepare(`DELETE FROM "EmergencyContact" WHERE id=?1 AND family_id=?2 RETURNING id`).bind(id, actor.familyId),
    ]);
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    return failure(404, "Not found");
  }
  return { status: 200, body: { success: true } };
}

export async function readD1Medications(actor: D1HealthActor, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "sick-days", false, database);
  if (denied) return denied;
  const db = store.withSession("first-primary"), own = isKidRole(actor.role) ? ` AND m.person_id=?2` : "";
  const statement = own
    ? db.prepare(`SELECT m.* FROM "Medication" m WHERE m.family_id=?1 AND m.active=1${own} ORDER BY m.created_at DESC`).bind(actor.familyId, actor.userId)
    : db.prepare(`SELECT m.* FROM "Medication" m WHERE m.family_id=?1 AND m.active=1 ORDER BY m.created_at DESC`).bind(actor.familyId);
  const rows = await statement.all<any>();
  const people = rows.results.length ? await db.prepare(`SELECT id,name,avatar_url FROM "User" WHERE family_id=?1 AND id IN (${rows.results.map((_, index) => `?${index + 2}`).join(",")})`).bind(actor.familyId, ...rows.results.map(row => row.person_id)).all<any>() : { results: [] as any[] };
  const personMap = new Map(people.results.map(row => [row.id, row]));
  return { status: 200, body: { medications: rows.results.map(row => ({ id: row.id, sick_day_id: row.sick_day_id ?? null, person_id: row.person_id, person_name: personMap.get(row.person_id)?.name ?? "Family member", name: row.name, dosage: row.dosage, schedule: row.schedule, next_dose_at: dateValue(row.next_dose_at)?.toISOString() ?? null, last_dose_at: dateValue(row.last_dose_at)?.toISOString() ?? null, active: Number(row.active) === 1, notes: row.notes ?? null })) } };
}

export async function createD1Medication(actor: D1HealthActor, input: any, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "sick-days", true, database);
  if (denied) return denied;
  const db = store.withSession("first-primary");
  if (!input.person_id || !input.name || !input.dosage || !input.schedule) return failure(400, "person_id, name, dosage, and schedule required");
  if (typeof input.person_id !== "string" || typeof input.name !== "string" || typeof input.dosage !== "string" || typeof input.schedule !== "string" || (input.notes != null && typeof input.notes !== "string") || (input.sick_day_id != null && typeof input.sick_day_id !== "string")) return failure(400, "person_id, name, dosage, schedule and notes must be strings");
  if (input.next_dose_at && (typeof input.next_dose_at !== "string" || Number.isNaN(Date.parse(input.next_dose_at)))) return failure(400, "next_dose_at must be an ISO date-time");
  if (!(await db.prepare(`SELECT id FROM "User" WHERE id=?1 AND family_id=?2`).bind(input.person_id, actor.familyId).first())) return failure(400, "Person not in your family");
  if (input.sick_day_id && !(await db.prepare(`SELECT id FROM "SickDay" WHERE id=?1 AND family_id=?2`).bind(input.sick_day_id, actor.familyId).first())) return failure(400, "Sick day not found");
  const now = new Date(), id = randomUUID();
  let result: Awaited<ReturnType<typeof db.batch>>;
  try {
    result = await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      db.prepare(`INSERT INTO "Medication" (id,sick_day_id,family_id,person_id,name,dosage,schedule,next_dose_at,notes,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULLIF(?9,''),?10,?11,?11) RETURNING *`).bind(id, input.sick_day_id || null, actor.familyId, input.person_id, input.name.trim(), input.dosage.trim(), input.schedule.trim(), input.next_dose_at ? new Date(input.next_dose_at).getTime() : null, input.notes?.trim() || "", actor.userId, now.getTime()),
    ]);
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    const current = await readAuthority(actor, "sick-days", true, database);
    return current.denied ?? failure(409, "Unable to create medication");
  }
  const row = result[1]?.results?.[0] as any;
  if (!row) return failure(409, "Unable to create medication");
  return { status: 201, body: { medication: medicationDto(row) } };
}

export async function updateD1Medication(actor: D1HealthActor, id: string, input: any, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "sick-days", false, database);
  if (denied) return denied;
  const db = store.withSession("first-primary"), existing = await db.prepare(`SELECT * FROM "Medication" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId).first<any>();
  if (!existing) return failure(404, "Not found");
  const kid = isKidRole(actor.role);
  if (kid && existing.person_id !== actor.userId) return failure(404, "Not found");
  if (kid && !input.markDoseTaken) return failure(403, "Only parents can edit medications");
  const data: Record<string, SqlValue> = {};
  if (input.markDoseTaken) {
    const takenAt = new Date(); data.last_dose_at = takenAt.getTime(); data.next_dose_at = null;
    if (!kid && input.interval_hours !== undefined) data.next_dose_at = takenAt.getTime() + input.interval_hours * 60 * 60 * 1000;
  }
  if (!kid) {
    if (input.name !== undefined) data.name = input.name;
    if (input.dosage !== undefined) data.dosage = input.dosage;
    if (input.schedule !== undefined) data.schedule = input.schedule;
    if (input.next_dose_at !== undefined) data.next_dose_at = input.next_dose_at ? new Date(input.next_dose_at).getTime() : null;
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
  }
  const fields = Object.keys(data);
  if (!fields.length) return { status: 200, body: { medication: medicationDto(existing) } };
  const now = new Date(Math.max(Date.now(), epoch(existing.updated_at) + 1));
  const assignments = fields.map((field, index) => `${field}=?${index + 3}`).join(",");
  const values = fields.map(field => data[field]);
  try {
    const result = await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "Medication" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
      db.prepare(`UPDATE "Medication" SET ${assignments},updated_at=?${fields.length + 3} WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId, ...values, now.getTime()),
      db.prepare(`SELECT * FROM "Medication" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId),
    ]);
    return { status: 200, body: { medication: medicationDto(result[3]?.results?.[0]) } };
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    return failure(404, "Not found");
  }
}

export async function deleteD1Medication(actor: D1HealthActor, id: string, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "sick-days", true, database);
  if (denied) return denied;
  const db = store.withSession("first-primary");
  try {
    await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "Medication" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
      db.prepare(`DELETE FROM "Medication" WHERE id=?1 AND family_id=?2 RETURNING id`).bind(id, actor.familyId),
    ]);
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    return failure(404, "Not found");
  }
  return { status: 200, body: { ok: true } };
}

export async function readD1SickDays(actor: D1HealthActor, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "sick-days", false, database);
  if (denied) return denied;
  const db = store.withSession("first-primary");
  const own = isKidRole(actor.role), rows = own
    ? await db.prepare(`SELECT s.*,u.name AS person_name,u.avatar_url AS person_avatar FROM "SickDay" s JOIN "User" u ON u.id=s.person_id AND u.family_id=s.family_id WHERE s.family_id=?1 AND s.status='active' AND s.person_id=?2 ORDER BY s.started_at DESC`).bind(actor.familyId, actor.userId).all<any>()
    : await db.prepare(`SELECT s.*,u.name AS person_name,u.avatar_url AS person_avatar FROM "SickDay" s JOIN "User" u ON u.id=s.person_id AND u.family_id=s.family_id WHERE s.family_id=?1 AND s.status='active' ORDER BY s.started_at DESC`).bind(actor.familyId).all<any>();
  const ids = rows.results.map(row => row.id);
  const meds = ids.length ? await db.prepare(`SELECT * FROM "Medication" WHERE family_id=?1 AND active=1 AND sick_day_id IN (${ids.map((_, index) => `?${index + 2}`).join(",")})${own ? ` AND person_id=?${ids.length + 2}` : ""}`).bind(actor.familyId, ...ids, ...(own ? [actor.userId] : [])).all<any>() : { results: [] as any[] };
  const medMap = new Map<string, any[]>();
  for (const med of meds.results) medMap.set(med.sick_day_id, [...(medMap.get(med.sick_day_id) ?? []), med]);
  return { status: 200, body: { sickDays: rows.results.map(row => ({ id: row.id, person_id: row.person_id, person_name: row.person_name, person_avatar: row.person_avatar, started_at: dateValue(row.started_at)?.toISOString(), ended_at: dateValue(row.ended_at)?.toISOString() ?? null, symptoms: row.symptoms ?? null, severity: row.severity, status: row.status, temperature_log: jsonValue(row.temperature_log), notes: row.notes ?? null, medications: (medMap.get(row.id) ?? []).map(med => ({ id: med.id, name: med.name, dosage: med.dosage, schedule: med.schedule, next_dose_at: dateValue(med.next_dose_at)?.toISOString() ?? null, last_dose_at: dateValue(med.last_dose_at)?.toISOString() ?? null, active: Number(med.active) === 1, notes: med.notes ?? null })) })) } };
}

export async function createD1SickDay(actor: D1HealthActor, input: any, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "sick-days", false, database);
  if (denied) return denied;
  const db = store.withSession("first-primary");
  const parsed = input && typeof input === "object" ? input : {};
  if (!parsed.person_id || !parsed.severity) return failure(400, "person_id and severity required");
  if (typeof parsed.person_id !== "string" || typeof parsed.severity !== "string") return failure(400, "person_id and severity must be strings");
  if (!["mild", "moderate", "severe"].includes(parsed.severity)) return failure(400, "severity must be one of: mild, moderate, severe");
  if (parsed.symptoms !== undefined && parsed.symptoms !== null && typeof parsed.symptoms !== "string") return failure(400, "symptoms must be a string");
  if (!(await db.prepare(`SELECT id FROM "User" WHERE id=?1 AND family_id=?2`).bind(parsed.person_id, actor.familyId).first())) return failure(400, "Person not in your family");
  if (isKidRole(actor.role) && parsed.person_id !== actor.userId) return failure(403, "You can only report yourself as sick");
  const now = new Date(), id = randomUUID();
  let result: Awaited<ReturnType<typeof db.batch>>;
  try {
    result = await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      db.prepare(`INSERT INTO "SickDay" (id,family_id,person_id,severity,symptoms,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7) RETURNING *`).bind(id, actor.familyId, parsed.person_id, parsed.severity, parsed.symptoms?.trim() || null, actor.userId, now.getTime()),
    ]);
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    const current = await readAuthority(actor, "sick-days", false, database);
    return current.denied ?? failure(409, "Unable to create sick day");
  }
  const row = result[1]?.results?.[0] as any;
  if (!row) return failure(409, "Unable to create sick day");
  return { status: 201, body: { sickDay: sickDayDto(row) } };
}

export async function updateD1SickDay(actor: D1HealthActor, id: string, body: any, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "sick-days", false, database);
  if (denied) return denied;
  const db = store.withSession("first-primary"), existing = await db.prepare(`SELECT * FROM "SickDay" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId).first<any>();
  if (!existing) return failure(404, "Not found");
  if (isKidRole(actor.role)) return existing.person_id === actor.userId ? parentsOnly() : failure(404, "Not found");
  if (!body || typeof body !== "object" || Array.isArray(body)) return failure(400, "Invalid body");
  const data: Record<string, SqlValue> = {};
  let temperature: string | null = null;
  if (body.addTemperature !== undefined) {
    const t = body.addTemperature;
    if (!t || typeof t !== "object" || typeof t.value !== "number" || !Number.isFinite(t.value) || typeof t.unit !== "string" || !["C", "F"].includes(t.unit)) return failure(400, "addTemperature requires a numeric value and unit C or F");
    temperature = JSON.stringify({ value: t.value, unit: t.unit, at: new Date().toISOString() });
  }
  if (body.endedAt !== undefined && body.endedAt !== null && body.endedAt !== "") {
    if (typeof body.endedAt !== "string" || Number.isNaN(Date.parse(body.endedAt))) return failure(400, "endedAt must be a valid date");
    data.ended_at = new Date(body.endedAt).getTime(); data.status = "recovered";
  }
  if (body.symptoms !== undefined) { if (body.symptoms !== null && typeof body.symptoms !== "string") return failure(400, "symptoms must be a string"); data.symptoms = body.symptoms; }
  if (body.severity !== undefined) { if (typeof body.severity !== "string" || !["mild", "moderate", "severe"].includes(body.severity)) return failure(400, "severity must be one of: mild, moderate, severe"); data.severity = body.severity; }
  if (body.notes !== undefined) { if (body.notes !== null && typeof body.notes !== "string") return failure(400, "notes must be a string"); data.notes = body.notes; }
  const fields = Object.keys(data), now = new Date(Math.max(Date.now(), epoch(existing.updated_at) + 1));
  const assignments = fields.map((field, index) => `${field}=?${index + 3}`).join(",");
  const values = fields.map(field => data[field]);
  const statements = [
    d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
    d1WriteCheck(db, `EXISTS (SELECT 1 FROM "SickDay" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
  ];
  if (fields.length || temperature) {
    let set = fields.length ? `${assignments},` : "";
    const tempPlaceholder = fields.length + 3;
    if (temperature) set += `temperature_log=CASE WHEN json_valid(temperature_log) AND json_type(temperature_log)='array' THEN json_insert(temperature_log,'$[#]',json(?${tempPlaceholder})) ELSE json_array(json(?${tempPlaceholder})) END,`;
    set += `updated_at=?${temperature ? tempPlaceholder + 1 : fields.length + 3}`;
    const binds = [id, actor.familyId, ...values, ...(temperature ? [temperature] : []), now.getTime()];
    statements.push(db.prepare(`UPDATE "SickDay" SET ${set} WHERE id=?1 AND family_id=?2 RETURNING id`).bind(...binds) as any);
  }
  statements.push(db.prepare(`SELECT * FROM "SickDay" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId) as any);
  try {
    const result = await db.batch(statements);
    const row = result[result.length - 1]?.results?.[0] as any;
    return { status: 200, body: { sickDay: sickDayDto(row) } };
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    return failure(404, "Not found");
  }
}

export async function deleteD1SickDay(actor: D1HealthActor, id: string, database?: D1Store): Promise<NativeResult> {
  const { store, denied } = await readAuthority(actor, "sick-days", false, database);
  if (denied) return denied;
  const db = store.withSession("first-primary"), existing = await db.prepare(`SELECT person_id FROM "SickDay" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId).first<{ person_id: string }>();
  if (!existing) return failure(404, "Not found");
  if (isKidRole(actor.role)) return existing.person_id === actor.userId ? parentsOnly() : failure(404, "Not found");
  try {
    await db.batch([
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation]),
      d1WriteCheck(db, `EXISTS (SELECT 1 FROM "SickDay" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
      db.prepare(`DELETE FROM "SickDay" WHERE id=?1 AND family_id=?2 RETURNING id`).bind(id, actor.familyId),
    ]);
  } catch (error) {
    if (!isD1WriteConflict(error)) throw error;
    return failure(404, "Not found");
  }
  return { status: 200, body: { ok: true } };
}
