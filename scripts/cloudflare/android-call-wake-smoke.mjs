#!/usr/bin/env node
/** Real workerd/D1/crypto; provider fetches are fabricated, never external. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, generateKeyPairSync } from "node:crypto";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
const root = fileURLToPath(new URL("../../", import.meta.url));
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
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
    name: "android-call-wake-fixture",
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-13",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      LOCAL_NATIVE_CALL_FIXTURE: "1",
      NATIVE_CALL_TOKEN_KEY: randomBytes(32).toString("base64"),
      LOCAL_FCM_SERVICE_ACCOUNT: JSON.stringify({
        type: "service_account",
        project_id: "herewoven-fixture",
        private_key_id: "a".repeat(40),
        private_key: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
        client_email: "fixture@herewoven-fixture.iam.gserviceaccount.com",
        token_uri: "https://oauth2.googleapis.com/token",
      }),
    },
    d1Databases: { DB: "android-call-wake-fixture" },
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
        "Fabricated family",
        randomUUID(),
        '{"calling":true}',
      )
      .run();
    await db
      .prepare('INSERT INTO "User" (id,email,name,family_id) VALUES (?,?,?,?)')
      .bind(
        `native-fixture-user-${actor}`,
        `wake-${actor}@example.test`,
        "Fabricated parent",
        `native-fixture-family-${actor}`,
      )
      .run();
  }
  await db
    .prepare('INSERT INTO "User" (id,email,name,family_id) VALUES (?,?,?,?)')
    .bind(
      "native-fixture-caller-a",
      "wake-caller@example.test",
      "Fabricated caller",
      "native-fixture-family-a",
    )
    .run();
  const clock = Date.now();
  const request = async (route, body) => {
    const response = await mf.dispatchFetch(
      `http://localhost/${route}?actor=a`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-local-fixture-time": String(clock),
        },
        body: JSON.stringify(body),
      },
    );
    assert.equal(response.status, 200, `fixture ${route} status`);
    return response.json();
  };
  for (const scenario of [
    "accepted",
    "foreign",
    "cancel",
    "logout",
    "caller-logout",
    "feature-off",
    "rotate",
    "revoke",
    "expired",
  ]) {
    await db.prepare('DELETE FROM "NativeCallInstallation"').run();
    await db.prepare('UPDATE "User" SET token_version=0').run();
    await db
      .prepare('UPDATE "Family" SET features=?')
      .bind('{"calling":true}')
      .run();
    const installationId = randomUUID();
    const registration = await request("register", {
      protocol: "herewoven.native-calls.v1",
      commandId: randomUUID(),
      issuedAt: clock,
      installationId,
      owner: {
        userId: "native-fixture-user-a",
        familyId: "native-fixture-family-a",
        generation: 0,
      },
      expected: null,
      label: "Fabricated phone",
      platform: "android",
      provider: "fcm",
      token: `fabricated-private-token-${randomUUID()}`,
    });
    const hint = {
      protocol: "herewoven.call-wake.v1",
      callId: randomUUID(),
      installationId,
      ...registration.stamp,
      expiresAt: scenario === "expired" ? clock : clock + 30_000,
    };
    const result = await request("wake", {
      hint,
      scenario,
      caller: scenario === "foreign" ? "b" : "a",
    });
    assert.equal(
      result.status,
      scenario === "accepted"
        ? "accepted"
        : scenario === "foreign"
          ? "unavailable"
          : scenario === "expired"
            ? "expired"
            : "cancelled",
      scenario,
    );
    assert.equal(
      result.providerRequests,
      scenario === "accepted" ? 1 : 0,
      `${scenario} destination attempts`,
    );
    assert.equal(
      result.tokenRequests,
      ["foreign", "expired"].includes(scenario) ? 0 : 1,
      `${scenario} OAuth attempts`,
    );
  }
  console.log(
    JSON.stringify({
      runtime: "workerd + native D1",
      scenarios: 9,
      registryDecryption: true,
      foreignHouseholdRefused: true,
      cancellationAndRevocationRechecked: true,
      providerUsed: false,
      production: false,
    }),
  );
} finally {
  await mf.dispose();
}
