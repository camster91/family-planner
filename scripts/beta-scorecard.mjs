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
const cohortAliases = entries.map(([alias]) => alias).sort();
const familyIds = entries.map(([, familyId]) => familyId);
if (
  entries.length !== 5 ||
  cohortAliases.join(",") !== "beta-01,beta-02,beta-03,beta-04,beta-05" ||
  entries.some(
    ([alias, familyId]) =>
      !/^beta-0[1-5]$/.test(alias) || typeof familyId !== "string" || !familyId,
  ) ||
  new Set(familyIds).size !== 5
) {
  throw new Error(
    "BETA_COHORTS must map exactly beta-01 through beta-05 to five unique family IDs",
  );
}

const start = new Date(`${startRaw}T00:00:00.000Z`);
if (
  Number.isNaN(start.getTime()) ||
  start.toISOString().slice(0, 10) !== startRaw ||
  start.getUTCDay() !== 1
) {
  throw new Error(
    "BETA_START_DATE must be a valid Monday in YYYY-MM-DD format",
  );
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  const { rows } = await client.query(
    `
      SELECT
        f.id,
        f.created_at,
        MIN(u.created_at) FILTER (WHERE u.role = 'parent') AS registered_at,
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
  const betaEnd = new Date(start.getTime() + 28 * 86_400_000);
  const { rows: reliabilityRows } = await client.query(
    `
      SELECT
        COUNT(*)::int AS attempts,
        COUNT(*) FILTER (WHERE success)::int AS successes
      FROM "BetaMetricEvent"
      WHERE family_id = ANY($1::text[])
        AND created_at >= $2
        AND created_at < $3
        AND event_name = ANY($4::text[])
    `,
    [
      familyIds,
      start,
      betaEnd,
      ["chore.assign", "chore.complete", "chore.verify", "reward.claim"],
    ],
  );
  const reliability = reliabilityRows[0];
  const reliabilityValue = reliability.attempts
    ? reliability.successes / reliability.attempts
    : null;

  const weeks = [];
  for (let index = 0; index < 4; index += 1) {
    const weekStart = new Date(start.getTime() + index * 7 * 86_400_000);
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
    const { rows: weeklyRows } = await client.query(
      `
        SELECT
          f.id,
          EXISTS (
            SELECT 1
            FROM "BetaMetricEvent" assigned
            JOIN "BetaMetricEvent" completed
              ON completed.family_id = assigned.family_id
             AND completed.event_name = 'chore.complete'
             AND completed.actor_role IN ('child', 'teen')
             AND completed.success
             AND completed.created_at > assigned.created_at
             AND completed.created_at < $3
            JOIN "BetaMetricEvent" verified
              ON verified.family_id = completed.family_id
             AND verified.event_name = 'chore.verify'
             AND verified.actor_role = 'parent'
             AND verified.success
             AND verified.created_at > completed.created_at
             AND verified.created_at < $3
            JOIN "BetaMetricEvent" claimed
              ON claimed.family_id = verified.family_id
             AND claimed.event_name = 'reward.claim'
             AND claimed.actor_role IN ('child', 'teen')
             AND claimed.success
             AND claimed.created_at > verified.created_at
             AND claimed.created_at < $3
            WHERE assigned.family_id = f.id
              AND assigned.event_name = 'chore.assign'
              AND assigned.actor_role = 'parent'
              AND assigned.success
              AND assigned.created_at >= $2
              AND assigned.created_at < $3
          ) AS completed_core_loop
        FROM "Family" f
        WHERE f.id = ANY($1::text[])
      `,
      [familyIds, weekStart, weekEnd],
    );
    const results = new Map(weeklyRows.map((row) => [row.id, row]));
    const completedAliases = entries
      .filter(([, familyId]) => {
        const row = results.get(familyId);
        return row?.completed_core_loop;
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
    const timeToFirstValueMinutes =
      row?.first_assignment_at && row?.registered_at
        ? Math.round(
            (new Date(row.first_assignment_at).getTime() -
              new Date(row.registered_at).getTime()) /
              60_000,
          )
        : null;
    return {
      cohort: alias,
      exists: Boolean(row),
      activated: Boolean(
        row &&
        row.registered_at &&
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
  const activationCount = householdResults.filter(
    (household) => household.activated,
  ).length;
  const timeToFirstValueThresholdMet =
    ttfv.length === 5 && median !== null && median <= 10;
  const mutationReliabilityThresholdMet =
    reliabilityValue !== null && reliabilityValue >= 0.99;
  const weeklyCoreLoopThresholdMet = weeks.every((week) => week.thresholdMet);

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        betaStartDate: startRaw,
        households: householdResults,
        activation: {
          count: activationCount,
          threshold: 5,
          thresholdMet: activationCount === 5,
        },
        medianTimeToFirstValueMinutes: median,
        timeToFirstValueObservationCount: ttfv.length,
        timeToFirstValueThresholdMet,
        weeks,
        weeklyCoreLoopThresholdMet,
        mutationReliability: {
          attempts: reliability.attempts,
          successes: reliability.successes,
          value: reliabilityValue,
          threshold: 0.99,
          thresholdMet: mutationReliabilityThresholdMet,
        },
        automatedOutcomeThresholdsMet:
          activationCount === 5 &&
          timeToFirstValueThresholdMet &&
          weeklyCoreLoopThresholdMet &&
          mutationReliabilityThresholdMet,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
