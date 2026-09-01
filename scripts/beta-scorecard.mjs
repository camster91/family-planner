#!/usr/bin/env node

import pg from "pg";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;
const cohortRaw = process.env.BETA_COHORTS;
const startRaw = process.env.BETA_START_DATE;

if (!databaseUrl || !cohortRaw || !startRaw) {
  throw new Error(
    "DATABASE_URL, BETA_COHORTS, and BETA_START_DATE are required",
  );
}

const cohorts = JSON.parse(cohortRaw);
const entries = Object.entries(cohorts);
if (
  entries.length !== 5 ||
  entries.some(
    ([alias, familyId]) =>
      !/^beta-0[1-5]$/.test(alias) || typeof familyId !== "string" || !familyId,
  )
) {
  throw new Error(
    "BETA_COHORTS must map exactly beta-01 through beta-05 to family IDs",
  );
}

const start = new Date(`${startRaw}T00:00:00.000Z`);
if (Number.isNaN(start.getTime()) || start.getUTCDay() !== 1) {
  throw new Error(
    "BETA_START_DATE must be a valid Monday in YYYY-MM-DD format",
  );
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const familyIds = entries.map(([, familyId]) => familyId);
  const { rows } = await client.query(
    `
      SELECT
        f.id,
        f.created_at,
        COUNT(DISTINCT u.id)::int AS member_count,
        COUNT(DISTINCT u.id) FILTER (WHERE u.role = 'parent')::int AS parent_count,
        COUNT(DISTINCT u.id) FILTER (WHERE u.role IN ('child', 'teen'))::int AS youth_count,
        MIN(c.created_at) AS first_assignment_at
      FROM "Family" f
      LEFT JOIN "User" u ON u.family_id = f.id
      LEFT JOIN "Chore" c ON c.family_id = f.id
      WHERE f.id = ANY($1::text[])
      GROUP BY f.id, f.created_at
    `,
    [familyIds],
  );
  const familyRows = new Map(rows.map((row) => [row.id, row]));

  const weeks = [];
  for (let index = 0; index < 4; index += 1) {
    const weekStart = new Date(start.getTime() + index * 7 * 86_400_000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
    const { rows: weeklyRows } = await client.query(
      `
        SELECT
          f.id,
          EXISTS (
            SELECT 1 FROM "Chore" c
            WHERE c.family_id = f.id AND c.created_at >= $2 AND c.created_at < $3
          ) AS assigned,
          EXISTS (
            SELECT 1 FROM "Chore" c
            WHERE c.family_id = f.id AND c.completed_at >= $2 AND c.completed_at < $3
          ) AS completed,
          EXISTS (
            SELECT 1 FROM "Chore" c
            WHERE c.family_id = f.id AND c.verified_at >= $2 AND c.verified_at < $3
          ) AS verified,
          EXISTS (
            SELECT 1 FROM "Reward" r
            WHERE r.family_id = f.id AND r.claimed_at >= $2 AND r.claimed_at < $3
          ) AS reward_claimed
        FROM "Family" f
        WHERE f.id = ANY($1::text[])
      `,
      [familyIds, weekStart, weekEnd],
    );
    const results = new Map(weeklyRows.map((row) => [row.id, row]));
    const completedAliases = entries
      .filter(([, familyId]) => {
        const row = results.get(familyId);
        return (
          row?.assigned && row.completed && row.verified && row.reward_claimed
        );
      })
      .map(([alias]) => alias);
    weeks.push({
      week: index + 1,
      startsAt: weekStart.toISOString(),
      completedHouseholds: completedAliases,
      thresholdMet: completedAliases.length >= 3,
    });
  }

  const householdResults = entries.map(([alias, familyId]) => {
    const row = familyRows.get(familyId);
    const timeToFirstValueMinutes = row?.first_assignment_at
      ? Math.round(
          (new Date(row.first_assignment_at).getTime() -
            new Date(row.created_at).getTime()) /
            60_000,
        )
      : null;
    return {
      cohort: alias,
      exists: Boolean(row),
      activated: Boolean(
        row &&
        row.parent_count >= 1 &&
        row.youth_count >= 1 &&
        row.first_assignment_at,
      ),
      timeToFirstValueMinutes,
    };
  });
  const ttfv = householdResults
    .map((household) => household.timeToFirstValueMinutes)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  const median = ttfv.length
    ? ttfv.length % 2
      ? ttfv[Math.floor(ttfv.length / 2)]
      : (ttfv[ttfv.length / 2 - 1] + ttfv[ttfv.length / 2]) / 2
    : null;

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        betaStartDate: startRaw,
        households: householdResults,
        activation: {
          count: householdResults.filter((household) => household.activated)
            .length,
          threshold: 5,
        },
        medianTimeToFirstValueMinutes: median,
        timeToFirstValueThresholdMet: median !== null && median <= 10,
        weeks,
        mutationReliability: {
          value: null,
          threshold: 0.99,
          status: "requires valid-attempt telemetry before beta starts",
        },
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
