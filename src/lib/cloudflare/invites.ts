import type { D1Store } from './database'
import type { MembershipActor } from './membership'
export interface InviteSummaries { parent: string; teen: string; child: string; member: string }

export async function readD1Invites(db: D1Store, actor: MembershipActor, now: number) {
  const result = await db.withSession('first-primary').prepare(`SELECT i.id,i.email,i.role,i.expires_at,i.created_at
    FROM "FamilyInvite" i JOIN "User" a ON a.family_id=i.family_id
    WHERE a.id=?1 AND a.token_version=?2 AND a.role='parent' AND a.family_id=?3
    AND i.accepted_at IS NULL AND i.expires_at>?4 ORDER BY i.created_at DESC,i.id DESC`)
    .bind(actor.userId, actor.generation, actor.familyId, now)
    .all<{ id: string; email: string; role: string; expires_at: number; created_at: number }>()
  return result.results.map(row => ({ ...row, expires_at: new Date(row.expires_at), created_at: new Date(row.created_at) }))
}
export async function readD1InviteContext(db: D1Store, actor: MembershipActor, email: string) {
  return db.withSession('first-primary').prepare(`SELECT f.name AS family_name,a.name AS inviter_name,
    EXISTS (SELECT 1 FROM "User" m WHERE m.family_id=f.id AND m.email=?1) AS already_member
    FROM "User" a JOIN "Family" f ON f.id=a.family_id
    WHERE a.id=?2 AND a.family_id=?3 AND a.token_version=?4 AND a.role='parent'`)
    .bind(email, actor.userId, actor.familyId, actor.generation)
    .first<{ family_name: string; inviter_name: string; already_member: number }>()
}

export async function createD1Invite(db: D1Store, actor: MembershipActor, input: {
  id: string; auditId: string; email: string; role: string; hash: string; now: number; expires: number
  createdSummary: string; revokedSummaries: InviteSummaries
}) {
  const session = db.withSession('first-primary')
  const s = input.revokedSummaries
  const result = await session.batch<{ family_name: string; inviter_name: string }>([
    session.prepare(`INSERT INTO "AuditLog" (id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at)
      SELECT lower(hex(randomblob(16))),i.family_id,a.id,'person','invite.revoked','invite',i.id,
      CASE i.role WHEN 'parent' THEN ?1 WHEN 'teen' THEN ?2 WHEN 'child' THEN ?3 ELSE ?4 END,?5
      FROM "FamilyInvite" i JOIN "User" a ON a.family_id=i.family_id
      WHERE a.id=?6 AND a.family_id=?7 AND a.token_version=?8 AND a.role='parent'
      AND i.email=?9 AND i.accepted_at IS NULL AND i.expires_at>?5
      AND NOT EXISTS (SELECT 1 FROM "User" m WHERE m.family_id=a.family_id AND m.email=?9)`)
      .bind(s.parent, s.teen, s.child, s.member, input.now, actor.userId, actor.familyId, actor.generation, input.email),
    session.prepare(`DELETE FROM "FamilyInvite" WHERE family_id=?1 AND email=?2 AND accepted_at IS NULL
      AND EXISTS (SELECT 1 FROM "User" a WHERE a.id=?3 AND a.family_id=?1 AND a.token_version=?4 AND a.role='parent')
      AND NOT EXISTS (SELECT 1 FROM "User" m WHERE m.family_id=?1 AND m.email=?2)`)
      .bind(actor.familyId, input.email, actor.userId, actor.generation),
    session.prepare(`INSERT INTO "FamilyInvite" (id,family_id,email,role,token_hash,expires_at,created_by,created_at)
      SELECT ?1,a.family_id,?2,?3,?4,?5,a.id,?6 FROM "User" a
      WHERE a.id=?7 AND a.family_id=?8 AND a.token_version=?9 AND a.role='parent'
      AND NOT EXISTS (SELECT 1 FROM "User" m WHERE m.family_id=a.family_id AND m.email=?2)`)
      .bind(input.id, input.email, input.role, input.hash, input.expires, input.now, actor.userId, actor.familyId, actor.generation),
    session.prepare(`INSERT INTO "AuditLog" (id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at)
      SELECT ?1,family_id,created_by,'person','invite.created','invite',id,?2,?3 FROM "FamilyInvite" WHERE id=?4 AND changes()=1`)
      .bind(input.auditId, input.createdSummary, input.now, input.id),
    session.prepare(`SELECT f.name AS family_name,a.name AS inviter_name FROM "FamilyInvite" i
      JOIN "Family" f ON f.id=i.family_id JOIN "User" a ON a.id=i.created_by
      WHERE i.id=?1 AND i.token_hash=?2 AND a.id=?3 AND a.family_id=?4 AND a.token_version=?5 AND a.role='parent'`)
      .bind(input.id, input.hash, actor.userId, actor.familyId, actor.generation),
  ])
  return result[4].results[0] ?? null
}

/** Compensation can remove only this exact undelivered, unaccepted issue. */
export async function discardD1UndeliveredInvite(db: D1Store, id: string, hash: string, familyId: string): Promise<void> {
  await db.batch([
    db.prepare(`DELETE FROM "AuditLog" WHERE family_id=?1 AND action='invite.created' AND target_id=?2
      AND EXISTS (SELECT 1 FROM "FamilyInvite" WHERE id=?2 AND token_hash=?3 AND family_id=?1 AND accepted_at IS NULL)`)
      .bind(familyId, id, hash),
    db.prepare('DELETE FROM "FamilyInvite" WHERE id=?1 AND token_hash=?2 AND family_id=?3 AND accepted_at IS NULL').bind(id, hash, familyId),
  ])
}

export async function revokeD1Invite(db: D1Store, actor: MembershipActor, id: string, auditId: string, summaries: InviteSummaries, now: number): Promise<boolean> {
  const session = db.withSession('first-primary')
  const result = await session.batch([
    session.prepare(`INSERT INTO "AuditLog" (id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at)
      SELECT ?1,i.family_id,a.id,'person','invite.revoked','invite',i.id,
      CASE i.role WHEN 'parent' THEN ?2 WHEN 'teen' THEN ?3 WHEN 'child' THEN ?4 ELSE ?5 END,?6
      FROM "FamilyInvite" i JOIN "User" a ON a.family_id=i.family_id
      WHERE i.id=?7 AND i.family_id=?8 AND i.accepted_at IS NULL AND a.id=?9 AND a.role='parent' AND a.token_version=?10`)
      .bind(auditId, summaries.parent, summaries.teen, summaries.child, summaries.member, now, id, actor.familyId, actor.userId, actor.generation),
    session.prepare('DELETE FROM "FamilyInvite" WHERE id=?1 AND family_id=?2 AND accepted_at IS NULL AND changes()=1').bind(id, actor.familyId),
  ])
  return result[1].meta.changes === 1
}
