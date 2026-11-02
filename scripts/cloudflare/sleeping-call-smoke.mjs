#!/usr/bin/env node
/** Real local DO/WebSockets/D1; fabricated ownership proof, no push or media. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
const root = fileURLToPath(new URL("../../", import.meta.url));
const bundle = await build({
  entryPoints: [
    path.join(root, "scripts/cloudflare/fixtures/sleeping-calls.ts"),
  ],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  external: ["cloudflare:workers", "node:crypto"],
  tsconfig: path.join(root, "tsconfig.json"),
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    name: "sleeping-call-fixture",
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-10-13",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      LOCAL_SLEEPING_CALL_FIXTURE: "1",
      CALLING_ENABLED: "1",
      CALLING_NATIVE_REGISTRATION_ENABLED: "1",
      CALLING_NATIVE_COORDINATION_ENABLED: "1",
      JWT_SECRET: "fabricated-local-sleeping-call-key-at-least-32-characters",
      NEXT_PUBLIC_APP_URL: "http://localhost",
    },
    durableObjects: {
      FAMILY_CALLS: { className: "SleepingCallFixture", useSQLite: true },
    },
    d1Databases: { DB: "sleeping-call-fixture" },
    d1Persist: false,
    durableObjectsPersist: false,
  }),
);
const clients = [];
try {
  const db = await mf.getD1Database("DB");
  for (const file of (await fs.readdir(path.join(root, "database/cloudflare")))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    for (const sql of splitSqlQuery(
      await fs.readFile(path.join(root, "database/cloudflare", file), "utf8"),
    ))
      await db.prepare(sql).run();
  await db
    .prepare(
      'INSERT INTO "Family" (id,name,invite_code,features) VALUES (?,?,?,?)',
    )
    .bind(
      "sleeping-fixture-family",
      "Fabricated family",
      "sleeping-fixture-invite",
      '{"calling":true}',
    )
    .run();
  for (const person of ["a", "b", "c"])
    await db
      .prepare('INSERT INTO "User" (id,email,name,family_id) VALUES (?,?,?,?)')
      .bind(
        person,
        `sleeping-${person}@example.test`,
        "Fabricated person",
        "sleeping-fixture-family",
      )
      .run();
  const target = {
    installationId: "11111111-1111-4111-8111-111111111111",
    epoch: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    owner: { userId: "b", familyId: "sleeping-fixture-family", generation: 0 },
  };
  await db
    .prepare(
      `INSERT INTO "NativeCallInstallation"
    (id,family_id,user_id,generation,epoch,revision,platform,label,provider,push_token_enc,token_fingerprint,last_command_id,last_command_hash,expires_at)
    VALUES (?,?,?,0,?,1,'android','Fixture phone','fcm','fabricated-ciphertext','fixture-fingerprint','fixture-command','fixture-hash',?)`,
    )
    .bind(
      target.installationId,
      target.owner.familyId,
      "b",
      target.epoch,
      Date.now() + 600_000,
    )
    .run();
  const join = async (person) => {
    const session = await (
      await mf.dispatchFetch(`http://localhost/session?person=${person}`)
    ).json();
    const response = await mf.dispatchFetch(
      "http://localhost/api/calls/socket",
      {
        headers: {
          Upgrade: "websocket",
          Origin: "http://localhost",
          Cookie: `session_token=fabricated-session-${person}`,
          "Sec-WebSocket-Protocol": `herewoven.calls.v1, ${session.grant}`,
        },
      },
    );
    assert.equal(response.status, 101);
    const socket = response.webSocket;
    socket.accept();
    clients.push(socket);
    return { ...session, socket };
  };
  const control = async (op, person, callId, extra = {}) => {
    const response = await mf.dispatchFetch("http://localhost/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        op,
        endpointId: person?.endpointId,
        callId,
        target,
        ...extra,
      }),
    });
    assert.equal(response.status, 200, `${op} status`);
    return response.json();
  };
  const a = await join("a"),
    b = await join("b"),
    other = await join("b");
  const first = await control("begin", a);
  assert.equal(await control("reserve", a, first.callId), true);
  await control("reconstruct");
  assert.equal(await control("reserve", a, first.callId), false);
  assert.equal(await control("current", a, first.callId), true);
  assert.equal(
    await control("claim", b, first.callId),
    false,
    "push/account alone is not ownership proof",
  );
  const answers = await Promise.all(
    [b, other].map((peer) =>
      control("claim", peer, first.callId, { proof: "fabricated-local-proof" }),
    ),
  );
  assert.equal(answers.filter(Boolean).length, 1);
  await db
    .prepare(
      'UPDATE "NativeCallInstallation" SET push_token_enc=NULL,revoked_at=? WHERE id=?',
    )
    .bind(Date.now(), target.installationId)
    .run();
  const revoked = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("revocation acknowledgement timed out")),
      5000,
    );
    a.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "ended" && message.callId === first.callId) {
        clearTimeout(timer);
        resolve(message.reason);
      }
    });
  });
  a.socket.send(JSON.stringify({ type: "heartbeat" }));
  assert.equal(await revoked, "unavailable");
  assert.equal(
    await control("claim", other, first.callId, {
      proof: "fabricated-local-proof",
    }),
    false,
  );
  console.log(
    JSON.stringify({
      runtime: "local DO + real WebSockets + native D1",
      singleWinningAnswer: true,
      reservationSurvivesReconstruction: true,
      missingOwnershipProofRefused: true,
      revokedInstallationEndsCall: true,
      ownershipProof: "fabricated",
      providerUsed: false,
      mediaUsed: false,
      production: false,
    }),
  );
} finally {
  for (const client of clients) {
    try {
      client.close();
    } catch {}
  }
  await mf.dispose();
}
