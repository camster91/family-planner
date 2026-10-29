import type { D1Store } from './database'

export interface MembershipActor { userId: string; familyId: string; generation: number }
export interface MembershipUser { id: string; email: string; name: string; role: string; family_id: string | null }

export async function readD1MembershipUser(db: D1Store, userId: string, generation: number): Promise<MembershipUser | null> {
  return db.withSession('first-primary').prepare('SELECT id,email,name,role,family_id FROM "User" WHERE id=?1 AND token_version=?2')
    .bind(userId, generation).first<MembershipUser>()
}
export async function findD1FamilyByCode(db: D1Store, code: string) {
  return db.withSession('first-primary').prepare('SELECT id,name FROM "Family" WHERE invite_code=?1').bind(code).first<{ id: string; name: string }>()
}

/** No email or family-code value is selected for a non-parent viewer. */
export async function readD1Family(db: D1Store, actor: MembershipActor) {
  const row = await db.withSession('first-primary').prepare(`SELECT f.id,f.name,
    CASE WHEN a.role='parent' THEN f.invite_code ELSE NULL END AS invite_code,
    f.subscription_tier,f.created_at,f.features,a.role,
    (SELECT count(*) FROM "User" m WHERE m.family_id=f.id) AS member_count
    FROM "User" a JOIN "Family" f ON f.id=a.family_id
    WHERE a.id=?1 AND a.token_version=?2 AND a.family_id=?3`)
    .bind(actor.userId, actor.generation, actor.familyId)
    .first<{ id: string; name: string; invite_code: string | null; subscription_tier: string; created_at: number; features: string | null; role: string; member_count: number }>()
  if (!row) return null
  const { role, ...family } = row
  return { role, family: { ...family, created_at: new Date(family.created_at), features: family.features === null ? null : JSON.parse(family.features) } }
}
export async function readD1FamilyMembers(db: D1Store, userId: string, generation: number) {
  const result = await db.withSession('first-primary').prepare(`SELECT m.id,m.name,m.avatar_url,m.role,
    CASE WHEN a.role='parent' THEN m.email ELSE NULL END AS email,a.role AS viewer_role
    FROM "User" a JOIN "User" m ON m.family_id=a.family_id
    WHERE a.id=?1 AND a.token_version=?2 ORDER BY m.name,m.id`)
    .bind(userId, generation).all<{ id: string; name: string; avatar_url: string | null; role: string; email: string | null; viewer_role: string }>()
  return result.results.map(({ viewer_role, email, ...member }) => viewer_role === 'parent' ? { ...member, email } : member)
}

export interface D1JoinInput {
  userId: string; generation: number; expectedName: string; now: number; auditId: string
  code?: string; tokenHash?: string
  summaries: { parent: string; teen: string; child: string }
}

/**
 * SQLite changes() gates the audit and invite claim on this batch's winning
 * update. D1 runs the statements on one atomic transaction/connection. A losing
 * join writes neither audit nor claim. No callback transaction or lock no-op.
 */
export async function joinD1Family(db: D1Store, input: D1JoinInput) {
  const session = db.withSession('first-primary')
  const update = input.tokenHash
    ? session.prepare(`UPDATE "User" AS u SET family_id=i.family_id,role=i.role
      FROM "FamilyInvite" i JOIN "Family" f ON f.id=i.family_id
      WHERE u.id=?1 AND u.token_version=?2 AND u.family_id IS NULL AND u.name=?3
      AND i.token_hash=?4 AND i.email=lower(u.email) AND i.accepted_at IS NULL
      AND i.expires_at>?5 AND i.role IN ('parent','teen','child')`)
      .bind(input.userId, input.generation, input.expectedName, input.tokenHash, input.now)
    : session.prepare(`UPDATE "User" AS u SET family_id=f.id,role=CASE WHEN u.role='teen' THEN 'teen' ELSE 'child' END
      FROM "Family" f WHERE u.id=?1 AND u.token_version=?2 AND u.family_id IS NULL AND u.name=?3 AND f.invite_code=?4`)
      .bind(input.userId, input.generation, input.expectedName, input.code ?? null)
  const statements = [update,
    session.prepare(`INSERT INTO "AuditLog" (id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at)
      SELECT ?1,family_id,id,'person','member.joined','member',id,
      CASE role WHEN 'parent' THEN ?2 WHEN 'teen' THEN ?3 ELSE ?4 END,?5 FROM "User"
      WHERE changes()=1 AND id=?6`)
      .bind(input.auditId, input.summaries.parent, input.summaries.teen, input.summaries.child, input.now, input.userId),
  ]
  if (input.tokenHash) statements.push(session.prepare(`UPDATE "FamilyInvite" SET accepted_at=?1
    WHERE changes()=1 AND token_hash=?2 AND accepted_at IS NULL AND expires_at>?1
    AND EXISTS (SELECT 1 FROM "User" u WHERE u.id=?3 AND u.family_id="FamilyInvite".family_id AND lower(u.email)="FamilyInvite".email)`)
    .bind(input.now, input.tokenHash, input.userId))
  statements.push(session.prepare(`SELECT u.id,u.email,u.name,u.role,u.family_id,f.name AS family_name
    FROM "User" u JOIN "Family" f ON f.id=u.family_id JOIN "AuditLog" a ON a.id=?1 AND a.actor_user_id=u.id AND a.family_id=u.family_id
    WHERE u.id=?2 AND u.token_version=?3`).bind(input.auditId, input.userId, input.generation))
  const result = await session.batch<MembershipUser & { family_name: string }>(statements)
  return result[result.length - 1].results[0] ?? null
}

export async function rotateD1FamilyCode(db: D1Store, actor: MembershipActor, code: string, auditId: string, summary: string, now: number): Promise<boolean> {
  const session = db.withSession('first-primary')
  const result = await session.batch([
    session.prepare(`UPDATE "Family" SET invite_code=?1 WHERE id=?2 AND EXISTS
      (SELECT 1 FROM "User" WHERE id=?3 AND family_id=?2 AND role='parent' AND token_version=?4)`)
      .bind(code, actor.familyId, actor.userId, actor.generation),
    session.prepare(`INSERT INTO "AuditLog" (id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at)
      SELECT ?1,?2,?3,'person','invite_code.rotated','family',?2,?4,?5 WHERE changes()=1`)
      .bind(auditId, actor.familyId, actor.userId, summary, now),
  ])
  return result[0].meta.changes === 1
}
