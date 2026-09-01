#!/usr/bin/env node

import pg from "pg";

const { Client } = pg;
const baseUrl = process.env.APP_URL;
const databaseUrl = process.env.DATABASE_URL;

if (!baseUrl || !databaseUrl) {
  throw new Error("APP_URL and DATABASE_URL are required");
}

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = "CoreLoop-CI-Only-42!";
const emails = {
  parent: `ci-parent-${runId}@family-planner.invalid`,
  child: `ci-child-${runId}@family-planner.invalid`,
  outsider: `ci-outsider-${runId}@family-planner.invalid`,
};
const db = new Client({ connectionString: databaseUrl });
await db.connect();

async function request(
  path,
  { cookie, expected = 200, method = "GET", body } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  if (response.status !== expected) {
    throw new Error(
      `${method} ${path}: expected ${expected}, received ${response.status}: ${raw}`,
    );
  }
  return { response, payload };
}

async function register(email, name, role) {
  const { payload } = await request("/api/auth/register", {
    method: "POST",
    expected: 200,
    body: { email, password, name, role },
  });
  if (!payload?.requiresVerification || !payload?.user?.id) {
    throw new Error(
      `registration did not return a verification-gated user for ${role}`,
    );
  }
  return payload.user;
}

async function verify(email) {
  const result = await db.query(
    'UPDATE "User" SET email_verified = true, verify_token = NULL, verify_token_expires = NULL WHERE email = $1',
    [email],
  );
  if (result.rowCount !== 1)
    throw new Error(`could not verify disposable user ${email}`);
}

async function login(email) {
  const { response } = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (!cookie?.startsWith("session_token="))
    throw new Error(`login did not issue a session for ${email}`);
  return cookie;
}

let familyA = null;
let familyB = null;

try {
  const parent = await register(emails.parent, "CI Parent", "parent");
  await request("/api/auth/login", {
    method: "POST",
    expected: 403,
    body: { email: emails.parent, password },
  });
  await verify(emails.parent);
  const parentCookie = await login(emails.parent);

  ({
    payload: { family: familyA },
  } = await request("/api/family", {
    method: "POST",
    cookie: parentCookie,
    body: { name: `Core Loop Family ${runId}` },
  }));
  if (!familyA?.id || !familyA?.invite_code)
    throw new Error("parent could not create a family");

  const child = await register(emails.child, "CI Child", "child");
  await verify(emails.child);
  const childCookie = await login(emails.child);
  await request("/api/family/join", {
    method: "POST",
    cookie: childCookie,
    body: { inviteCode: familyA.invite_code },
  });

  const outsider = await register(emails.outsider, "CI Other Parent", "parent");
  await verify(emails.outsider);
  const outsiderCookie = await login(emails.outsider);
  ({
    payload: { family: familyB },
  } = await request("/api/family", {
    method: "POST",
    cookie: outsiderCookie,
    body: { name: `Isolation Family ${runId}` },
  }));

  const { payload: membersPayload } = await request("/api/family/members", {
    cookie: parentCookie,
  });
  if (
    !membersPayload?.members?.some(
      (member) => member.id === child.id && member.role === "child",
    )
  ) {
    throw new Error("joined child is not visible in the parent family");
  }

  const { payload: chorePayload } = await request("/api/chores/create", {
    method: "POST",
    cookie: parentCookie,
    body: {
      title: "Release gate core-loop chore",
      points: 10,
      assigned_to: child.id,
      due_date: new Date(Date.now() + 86_400_000).toISOString(),
      difficulty: "medium",
      frequency: "once",
    },
  });
  const choreId = chorePayload?.chore?.id;
  if (!choreId) throw new Error("parent could not assign the core-loop chore");

  await request("/api/chores/verify", {
    method: "POST",
    cookie: childCookie,
    expected: 403,
    body: { choreId },
  });
  await request("/api/chores/verify", {
    method: "POST",
    cookie: outsiderCookie,
    expected: 403,
    body: { choreId },
  });

  await request("/api/chores/complete", {
    method: "POST",
    cookie: childCookie,
    body: { choreId, photoUrl: null },
  });
  await request("/api/chores/verify", {
    method: "POST",
    cookie: parentCookie,
    body: { choreId, verificationNotes: "Automated release-gate verification" },
  });

  const { payload: childAfterChore } = await request("/api/auth/me", {
    cookie: childCookie,
  });
  if (!(childAfterChore?.user?.xp > 0))
    throw new Error("verified chore did not award XP");

  const { payload: rewardPayload } = await request("/api/rewards", {
    method: "POST",
    cookie: parentCookie,
    body: {
      name: "Release gate reward",
      description: "Disposable CI reward",
      cost: 1,
      icon: "gift",
    },
  });
  const rewardId = rewardPayload?.reward?.id;
  if (!rewardId)
    throw new Error("parent could not create the core-loop reward");

  await request("/api/rewards/claim", {
    method: "POST",
    cookie: childCookie,
    body: { rewardId },
  });
  const { payload: rewardsAfterClaim } = await request("/api/rewards", {
    cookie: parentCookie,
  });
  const claimed = rewardsAfterClaim?.rewards?.find(
    (reward) => reward.id === rewardId,
  );
  if (claimed?.status !== "claimed" || claimed?.claimed_by !== child.id) {
    throw new Error("child reward claim did not persist");
  }

  await request("/api/family", {
    method: "DELETE",
    cookie: parentCookie,
    body: { familyId: familyA.id },
  });
  familyA = null;
  await request("/api/family", {
    method: "DELETE",
    cookie: outsiderCookie,
    body: { familyId: familyB.id },
  });
  familyB = null;

  console.log(
    "Core loop passed: register -> verify -> family -> invite -> assign -> complete -> verify -> reward",
  );
} finally {
  if (familyA?.id)
    await db.query('DELETE FROM "Family" WHERE id = $1', [familyA.id]);
  if (familyB?.id)
    await db.query('DELETE FROM "Family" WHERE id = $1', [familyB.id]);
  await db.query('DELETE FROM "User" WHERE email = ANY($1::text[])', [
    Object.values(emails),
  ]);
  await db.end();
}
