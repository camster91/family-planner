#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const { Client } = pg;
const run = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const client = new Client({ connectionString: databaseUrl });
const prefix = `beta-scorecard-${process.pid}`;
const startDate = "2026-08-31";
const familyIds = Array.from(
  { length: 5 },
  (_, index) => `${prefix}-family-${index + 1}`,
);
const cohorts = Object.fromEntries(
  familyIds.map((familyId, index) => [`beta-0${index + 1}`, familyId]),
);

await client.connect();

try {
  for (let index = 0; index < familyIds.length; index += 1) {
    const familyId = familyIds[index];
    const parentId = `${prefix}-parent-${index + 1}`;
    const childId = `${prefix}-child-${index + 1}`;
    const choreId = `${prefix}-chore-${index + 1}`;
    const rewardId = `${prefix}-reward-${index + 1}`;
    const registeredAt = new Date(`2026-08-31T00:0${index}:00.000Z`);
    const familyCreatedAt = new Date(registeredAt.getTime() + 60_000);
    const assignedAt = new Date(registeredAt.getTime() + 5 * 60_000);
    const completedAt = new Date(registeredAt.getTime() + 6 * 60_000);
    const verifiedAt = new Date(registeredAt.getTime() + 7 * 60_000);
    const claimedAt = new Date(registeredAt.getTime() + 8 * 60_000);

    await client.query(
      `INSERT INTO "Family" (id, name, invite_code, created_at)
       VALUES ($1, $2, $3, $4)`,
      [
        familyId,
        `Beta family ${index + 1}`,
        `${prefix}-invite-${index + 1}`,
        familyCreatedAt,
      ],
    );
    await client.query(
      `INSERT INTO "User" (id, email, name, role, family_id, created_at)
       VALUES ($1, $2, $3, 'parent', $4, $5),
              ($6, $7, $8, 'child', $4, $9)`,
      [
        parentId,
        `${prefix}-parent-${index + 1}@example.invalid`,
        `Beta parent ${index + 1}`,
        familyId,
        registeredAt,
        childId,
        `${prefix}-child-${index + 1}@example.invalid`,
        `Beta child ${index + 1}`,
        familyCreatedAt,
      ],
    );
    await client.query(
      `INSERT INTO "Chore"
         (id, family_id, title, assigned_to, due_date, status, verified_at,
          completed_at, created_at, created_by)
       VALUES ($1, $2, 'Beta scorecard chore', $3, $4, 'verified', $5, $6, $7, $8)`,
      [
        choreId,
        familyId,
        childId,
        assignedAt,
        verifiedAt,
        completedAt,
        assignedAt,
        parentId,
      ],
    );
    await client.query(
      `INSERT INTO "Reward"
         (id, family_id, name, status, created_by, claimed_by, claimed_at, created_at)
       VALUES ($1, $2, 'Beta scorecard reward', 'claimed', $3, $4, $5, $6)`,
      [rewardId, familyId, parentId, childId, claimedAt, assignedAt],
    );

    for (const [eventIndex, eventName] of [
      "chore.assign",
      "chore.complete",
      "chore.verify",
      "reward.claim",
    ].entries()) {
      await client.query(
        `INSERT INTO "BetaMetricEvent"
           (id, family_id, actor_role, event_name, success, duration_ms, created_at)
         VALUES ($1, $2, $3, $4, true, 25, $5)`,
        [
          `${prefix}-metric-${index + 1}-${eventIndex + 1}`,
          familyId,
          eventName === "chore.complete" || eventName === "reward.claim"
            ? "child"
            : "parent",
          eventName,
          new Date(assignedAt.getTime() + eventIndex * 60_000),
        ],
      );
    }
  }

  const { stdout } = await run(
    process.execPath,
    ["scripts/beta-scorecard.mjs"],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        BETA_START_DATE: startDate,
        BETA_COHORTS: JSON.stringify(cohorts),
      },
    },
  );
  const scorecard = JSON.parse(stdout);

  if (scorecard.activation?.count !== 5) {
    throw new Error(`expected five activated households: ${stdout}`);
  }
  if (scorecard.medianTimeToFirstValueMinutes !== 5) {
    throw new Error(
      `expected five-minute registration-to-value median: ${stdout}`,
    );
  }
  if (
    !scorecard.weeks?.[0]?.thresholdMet ||
    scorecard.weeks[0].completedHouseholds.length !== 5
  ) {
    throw new Error(
      `expected all five households to complete week one: ${stdout}`,
    );
  }
  if (
    scorecard.mutationReliability?.value !== 1 ||
    !scorecard.mutationReliability.thresholdMet
  ) {
    throw new Error(`expected perfect seeded mutation reliability: ${stdout}`);
  }

  console.log(
    "Beta scorecard smoke passed: activation, registration-to-value, weekly loop, reliability",
  );
} finally {
  await client.query('DELETE FROM "Family" WHERE id = ANY($1::text[])', [
    familyIds,
  ]);
  await client.query('DELETE FROM "User" WHERE email LIKE $1', [
    `${prefix}-%@example.invalid`,
  ]);
  await client.end();
}
