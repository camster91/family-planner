#!/usr/bin/env node
/** Disposable workerd/D1 registration, isolation and lifecycle checks. No providers. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
const root = fileURLToPath(new URL("../../", import.meta.url));
const bundle = await build({
  entryPoints: [
    path.join(
      root,
      "scripts/cloudflare/fixtures/native-calling-registration.ts",
    ),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  external: ["node:crypto"],
  tsconfig: path.join(root, "tsconfig.json"),
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: "native-call-registration-fixture",
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-13",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      LOCAL_NATIVE_CALL_FIXTURE: "1",
      NATIVE_CALL_TOKEN_KEY: randomBytes(32).toString("base64"),
    },
    d1Databases: { DB: "native-call-registration-fixture" },
    d1Persist: false,
  }),
);
try {
  const db = await mf.getD1Database("DB");
  for (const file of (await fs.readdir(path.join(root, "database/cloudflare")))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of splitSqlQuery(
      await fs.readFile(path.join(root, "database/cloudflare", file), "utf8"),
    ))
      await db.prepare(sql).run();
  for (const actor of ["a", "b"]) {
    await db
      .prepare(
        'INSERT INTO "Family" (id,name,invite_code,features) VALUES (?,?,?,?)',
      )
      .bind(
        `native-fixture-family-${actor}`,
        "Fabricated household",
        randomUUID(),
        '{"calling":true}',
      )
      .run();
    await db
      .prepare('INSERT INTO "User" (id,email,name,family_id) VALUES (?,?,?,?)')
      .bind(
        `native-fixture-user-${actor}`,
        `native-fixture-${actor}@example.test`,
        "Fabricated parent",
        `native-fixture-family-${actor}`,
      )
      .run();
  }
  let fixtureNow = Date.now();
  const owner = (actor) => ({
    userId: `native-fixture-user-${actor}`,
    familyId: `native-fixture-family-${actor}`,
    generation: 0,
  });
  const command = (actor = "a", overrides = {}) => ({
    protocol: "herewoven.native-calls.v1",
    commandId: randomUUID(),
    issuedAt: fixtureNow,
    installationId: randomUUID(),
    owner: owner(actor),
    expected: null,
    label: "Fabricated phone",
    platform: "android",
    provider: "fcm",
    token: "fabricated-native-token-" + randomUUID(),
    ...overrides,
  });
  const request = async (route, actor = "a", body) => {
    const r = await mf.dispatchFetch(
      `http://localhost/${route}?actor=${actor}`,
      body
        ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-local-fixture-time": String(fixtureNow),
            },
            body: JSON.stringify(body),
          }
        : {},
    );
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const reset = async () => {
    await db.prepare('DELETE FROM "NativeCallInstallation"').run();
    await db
      .prepare('UPDATE "User" SET family_id=?,token_version=0 WHERE id=?')
      .bind(owner("a").familyId, owner("a").userId)
      .run();
    await db
      .prepare('UPDATE "Family" SET features=? WHERE id=?')
      .bind('{"calling":true}', owner("a").familyId)
      .run();
  };
  let input = command(),
    saved = await request("register", "a", input);
  assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.equal(saved.body.backgroundRinging, false);
  assert.equal(saved.body.stamp.revision, 1);
  assert(!JSON.stringify(saved.body).includes(input.token));
  assert.deepEqual((await request("register", "a", input)).body, saved.body);
  assert.equal(
    (await request("register", "a", { ...input, label: "Different body" }))
      .status,
    409,
  );
  assert.deepEqual((await request("verify-sealing", "a", input)).body, {
    sealed: true,
    matches: true,
    foreignRejected: true,
    staleStampRejected: true,
  });
  assert.deepEqual((await request("list", "b")).body, []);
  assert.equal((await request("inspect", "b", input)).body, null);
  assert.equal(
    (
      await request(
        "register",
        "b",
        command("b", { installationId: input.installationId }),
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("register", "b", command("b", { token: input.token })))
      .status,
    409,
  );
  assert.equal(
    (await request("register", "a", command("a", { owner: owner("b") })))
      .status,
    409,
  );
  assert.equal(
    (
      await request(
        "register",
        "a",
        command("a", { issuedAt: Date.now() - 6 * 60_000 }),
      )
    ).status,
    410,
  );
  const updates = [
    command("a", {
      installationId: input.installationId,
      expected: saved.body.stamp,
    }),
    command("a", {
      installationId: input.installationId,
      expected: saved.body.stamp,
    }),
  ];
  const raced = await Promise.all(
    updates.map((c) => request("register", "a", c)),
  );
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
  const winner = raced.find((r) => r.status === 200).body;
  assert.equal(winner.stamp.revision, 2);
  const unlink = (stamp) => ({
    protocol: input.protocol,
    issuedAt: fixtureNow,
    installationId: input.installationId,
    owner: owner("a"),
    expected: stamp,
  });
  assert.equal(
    (await request("unlink", "a", unlink(saved.body.stamp))).status,
    409,
  );
  assert.equal(
    (await request("unlink", "a", unlink(winner.stamp))).status,
    200,
  );
  const revoked = (await request("inspect", "a", input)).body;
  assert.equal(revoked.revoked, true);
  assert.equal((await request("register", "a", input)).status, 409);
  const winningCommand = updates[raced.findIndex((r) => r.status === 200)];
  assert.equal(
    (
      await request(
        "register",
        "a",
        command("a", { token: winningCommand.token }),
      )
    ).status,
    409,
  );
  fixtureNow += 1;
  const reenabled = await request(
    "register",
    "a",
    command("a", {
      installationId: input.installationId,
      expected: revoked.stamp,
    }),
  );
  assert.equal(reenabled.status, 200);
  assert.equal(reenabled.body.revoked, false);
  await request("unlink", "a", unlink(reenabled.body.stamp));
  fixtureNow += 7 * 60_000;
  assert.equal((await request("register", "a", input)).status, 410);
  input = command("a", { installationId: input.installationId });
  saved = await request("register", "a", input);
  assert.equal(saved.status, 200);
  assert.notEqual(saved.body.stamp.epoch, winner.stamp.epoch);
  assert.equal(
    (await request("unlink", "a", unlink(winner.stamp))).status,
    409,
  );
  for (let n = 1; n < 8; n++)
    assert.equal((await request("register", "a", command())).status, 200);
  assert.equal((await request("register", "a", command())).status, 409);
  await db
    .prepare('UPDATE "NativeCallInstallation" SET expires_at=0 WHERE user_id=?')
    .bind(owner("a").userId)
    .run();
  assert.equal((await request("register", "a", command())).status, 200);
  assert.equal((await request("list", "a")).body.length, 1);
  await db
    .prepare('UPDATE "User" SET token_version=1 WHERE id=?')
    .bind(owner("a").userId)
    .run();
  assert.deepEqual((await request("list", "a")).body, []);
  assert.equal((await request("register", "a", command())).status, 409);
  fixtureNow = Date.now();
  await reset();
  const beforeMove = command();
  assert.equal((await request("register", "a", beforeMove)).status, 200);
  await db
    .prepare('UPDATE "User" SET family_id=? WHERE id=?')
    .bind(owner("b").familyId, owner("a").userId)
    .run();
  assert.equal(
    (
      await db
        .prepare(
          'SELECT count(*) AS n FROM "NativeCallInstallation" WHERE push_token_enc IS NOT NULL',
        )
        .first()
    ).n,
    0,
  );
  await db
    .prepare('UPDATE "User" SET family_id=? WHERE id=?')
    .bind(owner("a").familyId, owner("a").userId)
    .run();
  assert.equal((await request("register", "a", beforeMove)).status, 409);
  fixtureNow = Date.now();
  await reset();
  assert.equal((await request("register", "a", command())).status, 200);
  const beforeFeatureOff = command();
  assert.equal((await request("register", "a", beforeFeatureOff)).status, 200);
  await db
    .prepare('UPDATE "Family" SET features=? WHERE id=?')
    .bind('{"calling":false}', owner("a").familyId)
    .run();
  assert.equal(
    (
      await db
        .prepare(
          'SELECT count(*) AS n FROM "NativeCallInstallation" WHERE push_token_enc IS NOT NULL',
        )
        .first()
    ).n,
    0,
  );
  fixtureNow = Date.now();
  await db
    .prepare('UPDATE "Family" SET features=? WHERE id=?')
    .bind('{"calling":true}', owner("a").familyId)
    .run();
  assert.equal((await request("register", "a", beforeFeatureOff)).status, 409);
  await reset();
  assert.equal((await request("register", "a", command())).status, 200);
  await db
    .prepare('DELETE FROM "User" WHERE id=?')
    .bind(owner("a").userId)
    .run();
  assert.equal(
    (
      await db
        .prepare(
          'SELECT count(*) AS n FROM "NativeCallInstallation" WHERE push_token_enc IS NOT NULL',
        )
        .first()
    ).n,
    0,
  );
  assert.equal((await request("register", "b", command("b"))).status, 200);
  await db
    .prepare('DELETE FROM "Family" WHERE id=?')
    .bind(owner("b").familyId)
    .run();
  assert.equal(
    (
      await db
        .prepare(
          'SELECT count(*) AS n FROM "NativeCallInstallation" WHERE push_token_enc IS NOT NULL',
        )
        .first()
    ).n,
    0,
  );
  console.log(
    JSON.stringify({
      runtime: "local workerd + native D1",
      encryptedRouting: true,
      exactReplay: true,
      concurrentUpdate: true,
      foreignHouseholdRefused: true,
      staleUnlinkRefused: true,
      abaProtected: true,
      boundedRegistrations: true,
      expiredCommandRefused: true,
      logoutDepartureFeatureOffClearRouting: true,
      tokenlessRevocation: true,
      staleRegistrationReplayRefused: true,
      deletionCascade: true,
      providerUsed: false,
      production: false,
    }),
  );
} finally {
  await mf.dispose();
}
