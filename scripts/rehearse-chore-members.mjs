#!/usr/bin/env node
// #480 fixture-only rehearsal. Default is a dry run. There is no production override.
import pg from "pg";
const lib = new URL("../src/lib/", import.meta.url);
const { assertFixtureTargetAllowed } = await import(
  new URL("fixtures/guard.ts", lib).href
);
const { parseMemberRehearsalArgs, MemberRehearsalError } = await import(
  new URL("backfill/household-members.ts", lib).href
);
const { rehearseChoreMembers, ChoreMemberRehearsalError } = await import(
  new URL("backfill/chore-members.ts", lib).href
);
let client;
try {
  const args = parseMemberRehearsalArgs(process.argv.slice(2));
  assertFixtureTargetAllowed(process.env);
  client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(
    JSON.stringify(
      await rehearseChoreMembers(client, args.familyId, args.apply),
    ),
  );
} catch (error) {
  // No raw connection errors, names, IDs, emails or database URLs in reports.
  console.error(
    error instanceof MemberRehearsalError ||
      error instanceof ChoreMemberRehearsalError
      ? error.code
      : "MEMBER_REHEARSAL_REFUSED_OR_FAILED",
  );
  process.exitCode = 1;
} finally {
  try {
    await client?.end();
  } catch {
    console.error("MEMBER_REHEARSAL_CLEANUP_FAILED");
    process.exitCode = 1;
  }
}
