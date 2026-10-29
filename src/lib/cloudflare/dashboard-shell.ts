import type { D1Store } from "./database";

type ShellRow = {
  id: string;
  name: string;
  role: string;
  avatar_url: string | null;
  family_id: string | null;
  family_features: string | null;
};

/** One scoped native read: no query-compiler initialization for every layout. */
export async function readD1DashboardShell(
  db: D1Store,
  userId: string,
  sessionFamilyId: string | null,
) {
  const row = await db
    .withSession("first-primary")
    .prepare(
      `
    SELECT u.id,u.name,u.role,u.avatar_url,u.family_id,f.features AS family_features
    FROM "User" u LEFT JOIN "Family" f ON f.id=u.family_id AND f.id=?2
    WHERE u.id=?1
  `,
    )
    .bind(userId, sessionFamilyId)
    .first<ShellRow>();
  if (!row) return null;
  const { family_features, ...profile } = row;
  return {
    profile,
    familyFeatures:
      family_features === null
        ? null
        : { features: JSON.parse(family_features) },
  };
}
