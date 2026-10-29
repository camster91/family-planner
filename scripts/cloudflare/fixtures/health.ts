import {
  createD1EmergencyContact,
  createD1Medication,
  createD1SickDay,
  deleteD1EmergencyContact,
  deleteD1Medication,
  deleteD1SickDay,
  readD1EmergencyContacts,
  readD1Medications,
  readD1SickDays,
  updateD1EmergencyContact,
  updateD1Medication,
  updateD1SickDay,
} from '../../../src/lib/cloudflare/health'
import type { D1Store } from '../../../src/lib/cloudflare/database'

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label)
}

const parent = { userId: 'health-parent', familyId: 'health-family-a', role: 'parent', generation: 0 } as const
const child = { userId: 'health-child', familyId: 'health-family-a', role: 'child', generation: 0 } as const
const teen = { userId: 'health-teen', familyId: 'health-family-a', role: 'teen', generation: 0 } as const
const foreign = { userId: 'health-foreign', familyId: 'health-family-b', role: 'parent', generation: 0 } as const
const features = JSON.stringify({ emergency: true, 'sick-days': true })

/** Disposable native coverage for household-scoped medical and emergency flows. */
export async function testHealth(db: D1Store) {
  const now = Date.parse('2026-10-28T16:00:00.000Z')
  await db.batch([
    db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('health-family-a','Health A','health-code-a',?1),('health-family-b','Health B','health-code-b',?1)`).bind(features),
    db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,token_version) VALUES
      ('health-parent','health-parent@example.test','Health Parent','health-family-a','parent',0),
      ('health-child','health-child@example.test','Health Child','health-family-a','child',0),
      ('health-teen','health-teen@example.test','Health Teen','health-family-a','teen',0),
      ('health-foreign','health-foreign@example.test','Other Parent','health-family-b','parent',0)`),
    db.prepare(`INSERT INTO "EmergencyContact"(id,family_id,person_id,person_name,relationship,emergency_contact_name,created_at,updated_at) VALUES
      ('health-contact-a','health-family-a','health-child','Health Child','child','Health Grandparent',?1,?1),
      ('health-contact-b','health-family-b','health-foreign','Other Parent','self','Other Contact',?1,?1)`).bind(now),
    db.prepare(`INSERT INTO "SickDay"(id,family_id,person_id,started_at,symptoms,severity,status,temperature_log,created_by,created_at,updated_at) VALUES
      ('health-sick-a','health-family-a','health-child',?1,'Cough','mild','active','[]','health-parent',?1,?1),
      ('health-sick-b','health-family-b','health-foreign',?1,'Private','moderate','active','[]','health-foreign',?1,?1)`).bind(now),
    db.prepare(`INSERT INTO "Medication"(id,sick_day_id,family_id,person_id,name,dosage,schedule,next_dose_at,active,notes,created_by,created_at,updated_at) VALUES
      ('health-med-a','health-sick-a','health-family-a','health-child','Acetaminophen','10 ml','As needed',NULL,1,'For fever','health-parent',?1,?1),
      ('health-med-b','health-sick-b','health-family-b','health-foreign','Private medicine','1 tablet','Daily',NULL,1,NULL,'health-foreign',?1,?1)`).bind(now),
  ])

  const parentContacts = await readD1EmergencyContacts(parent, db)
  check(parentContacts.status === 200 && (parentContacts.body as any).contacts.length === 1, 'parent emergency contacts stay in household')
  check((await readD1EmergencyContacts(child, db)).status === 200, 'child can read emergency contacts')
  const foreignContacts = await readD1EmergencyContacts(foreign, db)
  check(foreignContacts.status === 200 && (foreignContacts.body as any).contacts.length === 1, 'foreign contacts stay isolated')
  check((await createD1EmergencyContact(child, { person_id: child.userId, person_name: 'No', relationship: 'self' }, db)).status === 403, 'child cannot create emergency contact')
  const createdContact = await createD1EmergencyContact(parent, { person_id: teen.userId, person_name: 'Health Teen', relationship: 'child', emergency_contact_name: 'Parent' }, db)
  check(createdContact.status === 201, 'parent creates emergency contact')
  const contactId = (createdContact.body as any).contact.id as string
  check((await updateD1EmergencyContact(parent, contactId, { notes: 'Updated' }, db)).status === 200, 'parent updates emergency contact')
  check((await deleteD1EmergencyContact(parent, contactId, db)).status === 200, 'parent deletes emergency contact')

  const childMeds = await readD1Medications(child, db)
  check(childMeds.status === 200 && (childMeds.body as any).medications.length === 1 && (childMeds.body as any).medications[0].person_id === child.userId, 'child sees only own medication')
  const parentMeds = await readD1Medications(parent, db)
  check(parentMeds.status === 200 && (parentMeds.body as any).medications.length === 1, 'parent sees household medications')
  const createdMedication = await createD1Medication(parent, { sick_day_id: 'health-sick-a', person_id: teen.userId, name: 'Ibuprofen', dosage: '5 ml', schedule: 'Nightly' }, db)
  check(createdMedication.status === 201, 'parent creates medication')
  const medicationId = (createdMedication.body as any).medication.id as string
  check((await updateD1Medication(child, 'health-med-a', { markDoseTaken: true }, db)).status === 200, 'child logs own dose')
  check((await updateD1Medication(child, 'health-med-a', { name: 'No edit' }, db)).status === 403, 'child cannot edit prescription')
  check((await updateD1Medication(parent, medicationId, { markDoseTaken: true, interval_hours: 6 }, db)).status === 200, 'parent logs dose with interval')
  check((await deleteD1Medication(parent, medicationId, db)).status === 200, 'parent deletes medication')

  const childSickDays = await readD1SickDays(child, db)
  check(childSickDays.status === 200 && (childSickDays.body as any).sickDays.length === 1 && (childSickDays.body as any).sickDays[0].person_id === child.userId, 'child sees only own sick day')
  const parentSickDays = await readD1SickDays(parent, db)
  check(parentSickDays.status === 200 && (parentSickDays.body as any).sickDays.length === 1, 'parent sees household sick days')
  check((await createD1SickDay(child, { person_id: child.userId, severity: 'mild', symptoms: 'Headache' }, db)).status === 201, 'child reports self sick')
  check((await createD1SickDay(child, { person_id: teen.userId, severity: 'mild' }, db)).status === 403, 'child cannot report another member')
  check((await updateD1SickDay(child, 'health-sick-a', { notes: 'No' }, db)).status === 403, 'child cannot edit sick day')
  const temperature = await updateD1SickDay(parent, 'health-sick-a', { addTemperature: { value: 38.2, unit: 'C' } }, db)
  check(temperature.status === 200, 'parent logs temperature')
  const afterTemperature = await readD1SickDays(parent, db)
  // A child self-report is created above, so the newest row is not guaranteed
  // to be the row whose temperature was appended. Assert against the keyed
  // sick-day record rather than relying on list ordering.
  const sickDayAfterTemperature = (afterTemperature.body as any).sickDays.find((row: any) => row.id === 'health-sick-a')
  check(Array.isArray(sickDayAfterTemperature?.temperature_log) && sickDayAfterTemperature.temperature_log.length === 1, 'temperature log is appended atomically')
  check((await updateD1SickDay(parent, 'health-sick-a', { endedAt: '2026-10-29T12:00:00.000Z' }, db)).status === 200, 'parent ends sick day')
  check((await deleteD1SickDay(parent, 'health-sick-a', db)).status === 200, 'parent deletes sick day')
  const foreignSickDays = await readD1SickDays(foreign, db)
  check(foreignSickDays.status === 200 && (foreignSickDays.body as any).sickDays.length === 1, 'foreign sick days stay isolated')

  return { emergencyContacts: true, medications: true, sickDays: true, roleVisibility: true, householdIsolation: true }
}
