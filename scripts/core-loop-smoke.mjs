#!/usr/bin/env node

import pg from "pg";

const { Client } = pg;
const baseUrl = process.env.APP_URL;
const databaseUrl = process.env.DATABASE_URL;
const clientIp = process.env.CORE_LOOP_CLIENT_IP;

if (!baseUrl || !databaseUrl) {
  throw new Error("APP_URL and DATABASE_URL are required");
}
if (
  clientIp &&
  !/^(192\.0\.2|198\.51\.100|203\.0\.113)\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(
    clientIp,
  )
) {
  throw new Error("CORE_LOOP_CLIENT_IP must be an RFC TEST-NET IPv4 address");
}

const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const password = "CoreLoop-CI-Only-42!";
const emails = {
  parent: `ci-parent-${runId}@family-planner.invalid`,
  child: `ci-child-${runId}@family-planner.invalid`,
  outsider: `ci-outsider-${runId}@family-planner.invalid`,
  deletable: `ci-delete-${runId}@family-planner.invalid`,
};
const db = new Client({ connectionString: databaseUrl });
await db.connect();

function createSession() {
  return { cookies: new Map() };
}

function storeCookies(session, headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
  for (const value of values) {
    const pair = value.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator > 0) {
      session.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

function cookieHeader(session) {
  return [...session.cookies]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

async function primeCsrf(session) {
  const response = await fetch(`${baseUrl}/login`, { redirect: "manual" });
  storeCookies(session, response.headers);
  if (!session.cookies.get("csrf_token")) {
    throw new Error("application did not issue a CSRF cookie");
  }
}

async function request(
  path,
  { session, expected = 200, method = "GET", body } = {},
) {
  if (
    session &&
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    !session.cookies.get("csrf_token")
  ) {
    await primeCsrf(session);
  }
  const csrfToken = session?.cookies.get("csrf_token");
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(session?.cookies.size ? { cookie: cookieHeader(session) } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...(clientIp ? { "x-forwarded-for": clientIp } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (session) storeCookies(session, response.headers);
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
      `${method} ${path}: expected ${expected}, received ${response.status}: ${raw.slice(0, 500)}`,
    );
  }
  return { response, payload };
}

async function register(session, email, name, role, inviteCode) {
  const { payload } = await request("/api/auth/register", {
    session,
    method: "POST",
    expected: 200,
    body: { email, password, name, role, inviteCode },
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

async function login(session, email) {
  await request("/api/auth/login", {
    session,
    method: "POST",
    body: { email, password },
  });
  if (!session.cookies.get("session_token"))
    throw new Error(`login did not issue a session for ${email}`);
}

let familyA = null;
let familyB = null;

try {
  const parentSession = createSession();
  const childSession = createSession();
  const outsiderSession = createSession();
  const deleteSession = createSession();

  const parent = await register(
    parentSession,
    emails.parent,
    "CI Parent",
    "parent",
  );
  await request("/api/auth/login", {
    session: parentSession,
    method: "POST",
    expected: 403,
    body: { email: emails.parent, password },
  });
  await verify(emails.parent);
  await login(parentSession, emails.parent);

  const { payload: profilePayload } = await request("/api/users", {
    session: parentSession,
  });
  for (const secretField of [
    "password",
    "reset_token",
    "reset_token_expires",
    "verify_token",
    "verify_token_expires",
  ]) {
    if (secretField in (profilePayload?.user || {})) {
      throw new Error(`profile response exposed ${secretField}`);
    }
  }

  ({
    payload: { family: familyA },
  } = await request("/api/family", {
    method: "POST",
    session: parentSession,
    body: { name: `Core Loop Family ${runId}` },
  }));
  if (!familyA?.id || !familyA?.invite_code)
    throw new Error("parent could not create a family");

  await request("/api/auth/register", {
    session: createSession(),
    method: "POST",
    expected: 400,
    body: {
      email: `uninvited-${emails.child}`,
      password,
      name: "Uninvited Child",
      role: "child",
    },
  });
  const child = await register(
    childSession,
    emails.child,
    "CI Child",
    "child",
    familyA.invite_code,
  );
  await verify(emails.child);
  await login(childSession, emails.child);
  await request("/api/users/preferences", {
    method: "PATCH",
    session: childSession,
    body: {
      choreUpdates: false,
      eventUpdates: false,
      newMessages: false,
    },
  });

  const outsider = await register(
    outsiderSession,
    emails.outsider,
    "CI Other Parent",
    "parent",
  );
  await verify(emails.outsider);
  await login(outsiderSession, emails.outsider);
  ({
    payload: { family: familyB },
  } = await request("/api/family", {
    method: "POST",
    session: outsiderSession,
    body: { name: `Isolation Family ${runId}` },
  }));

  await register(
    deleteSession,
    emails.deletable,
    "CI Delete Child",
    "child",
    familyA.invite_code,
  );
  await verify(emails.deletable);
  await login(deleteSession, emails.deletable);
  await request("/api/users", {
    method: "DELETE",
    session: deleteSession,
    body: { password, confirmation: "DELETE", deleteFamily: false },
  });
  await request("/api/auth/me", {
    session: deleteSession,
    expected: 401,
  });

  const { payload: membersPayload } = await request("/api/family/members", {
    session: parentSession,
  });
  if (
    !membersPayload?.members?.some(
      (member) => member.id === child.id && member.role === "child",
    )
  ) {
    throw new Error("joined child is not visible in the parent family");
  }

  await request("/api/events", {
    method: "POST",
    session: parentSession,
    body: {
      title: "Muted release gate event",
      start_time: new Date(Date.now() + 129_600_000).toISOString(),
      event_type: "family",
    },
  });
  await request("/api/messages", {
    method: "POST",
    session: parentSession,
    body: { content: "Muted release gate message", type: "text" },
  });

  const { payload: chorePayload } = await request("/api/chores/create", {
    method: "POST",
    session: parentSession,
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
  const { payload: mutedNotifications } = await request("/api/notifications", {
    session: childSession,
  });
  for (const mutedType of ["chore", "event", "message"]) {
    if (
      mutedNotifications?.notifications?.some(
        (notification) => notification.type === mutedType,
      )
    ) {
      throw new Error(
        `disabled ${mutedType} notifications were not suppressed`,
      );
    }
  }
  await request("/api/users/preferences", {
    method: "PATCH",
    session: childSession,
    body: {
      choreUpdates: true,
      eventUpdates: true,
      newMessages: true,
    },
  });
  await request("/api/events", {
    method: "POST",
    session: parentSession,
    body: {
      title: "Release gate family event",
      start_time: new Date(Date.now() + 172_800_000).toISOString(),
      event_type: "family",
    },
  });
  await request("/api/messages", {
    method: "POST",
    session: parentSession,
    body: {
      content: "Release gate family message",
      type: "text",
    },
  });
  const { payload: categoryNotifications } = await request(
    "/api/notifications",
    { session: childSession },
  );
  for (const expectedType of ["event", "message"]) {
    if (
      !categoryNotifications?.notifications?.some(
        (notification) => notification.type === expectedType,
      )
    ) {
      throw new Error(`enabled ${expectedType} notification was not delivered`);
    }
  }

  const { payload: parentSearch } = await request("/api/search?q=Release", {
    session: parentSession,
  });
  if (!parentSearch?.results?.some((result) => result.id === choreId)) {
    throw new Error("family search did not return the new chore");
  }
  const { payload: childSearch } = await request("/api/search?q=Release", {
    session: childSession,
  });
  if (!childSearch?.results?.some((result) => result.id === choreId)) {
    throw new Error("child could not search their family chore");
  }
  const { payload: outsiderSearch } = await request("/api/search?q=Release", {
    session: outsiderSession,
  });
  if (outsiderSearch?.results?.some((result) => result.id === choreId)) {
    throw new Error("cross-family search leaked a chore");
  }

  await request("/api/chores/verify", {
    method: "POST",
    session: childSession,
    expected: 403,
    body: { choreId },
  });
  await request("/api/chores/verify", {
    method: "POST",
    session: outsiderSession,
    expected: 403,
    body: { choreId },
  });

  await request("/api/chores/complete", {
    method: "POST",
    session: childSession,
    body: { choreId, photoUrl: null },
  });
  await request("/api/chores/verify", {
    method: "POST",
    session: parentSession,
    body: { choreId, verificationNotes: "Automated release-gate verification" },
  });

  const { payload: childAfterChore } = await request("/api/auth/me", {
    session: childSession,
  });
  if (!(childAfterChore?.user?.xp > 0))
    throw new Error("verified chore did not award XP");
  const { payload: enabledNotifications } = await request(
    "/api/notifications",
    { session: childSession },
  );
  if (
    !enabledNotifications?.notifications?.some(
      (notification) => notification.type === "chore",
    )
  ) {
    throw new Error("enabled chore notifications were not delivered");
  }

  const { payload: exportPayload } = await request("/api/users/export", {
    session: parentSession,
  });
  if (exportPayload?.schemaVersion !== 1 || !exportPayload?.user?.id) {
    throw new Error("account export did not return the versioned user archive");
  }
  if ("password" in exportPayload.user || "reset_token" in exportPayload.user) {
    throw new Error("account export leaked an authentication secret");
  }

  const { payload: rewardPayload } = await request("/api/rewards", {
    method: "POST",
    session: parentSession,
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
    session: childSession,
    body: { rewardId },
  });
  const { payload: rewardsAfterClaim } = await request("/api/rewards", {
    session: parentSession,
  });
  const claimed = rewardsAfterClaim?.rewards?.find(
    (reward) => reward.id === rewardId,
  );
  if (claimed?.status !== "claimed" || claimed?.claimed_by !== child.id) {
    throw new Error("child reward claim did not persist");
  }

  const metricResult = await db.query(
    `SELECT event_name, success, actor_role, duration_ms
     FROM "BetaMetricEvent"
     WHERE family_id = $1
     ORDER BY created_at`,
    [familyA.id],
  );
  for (const eventName of [
    "chore.assign",
    "chore.complete",
    "chore.verify",
    "reward.claim",
  ]) {
    if (
      !metricResult.rows.some(
        (metric) => metric.event_name === eventName && metric.success === true,
      )
    ) {
      throw new Error(`missing successful beta metric for ${eventName}`);
    }
  }
  if (
    metricResult.rows.some(
      (metric) =>
        !["parent", "child", "teen"].includes(metric.actor_role) ||
        metric.duration_ms < 0,
    )
  ) {
    throw new Error("beta metric contained invalid role or duration data");
  }

  await request("/api/family", {
    method: "DELETE",
    session: parentSession,
    body: { familyId: familyA.id },
  });
  familyA = null;
  await request("/api/family", {
    method: "DELETE",
    session: outsiderSession,
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
