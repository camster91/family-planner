#!/usr/bin/env node
/** Local workerd/D1 and real WebRTC with fabricated media. No provider/deploy.
 * Does not prove login, TURN/mobile-data, native background or physical audio. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "herewoven-call-media-"));
const config = path.join(root, `.wrangler-call-media-${process.pid}.json`);
const port = Number(process.env.CALLING_QA_PORT || 18441),
  origin = `http://localhost:${port}`;
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("Use a valid local fixture port");
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
const run = (args) =>
  execFileSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
let server,
  browser,
  serverLog = "";
try {
  const assets = path.join(temp, "assets");
  fs.mkdirSync(assets);
  await build({
    entryPoints: [
      path.join(root, "scripts/cloudflare/fixtures/calling-browser.ts"),
    ],
    outfile: path.join(assets, "app.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    tsconfig: path.join(root, "tsconfig.json"),
  });
  fs.writeFileSync(
    path.join(assets, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Local calling diagnostic</title><button id="enable">Enable</button><button id="voice">Voice</button><button id="video">Video</button><button id="answer-voice">Answer voice</button><button id="answer-video">Answer video</button><button id="camera">Camera</button><button id="end">End</button><button id="heartbeat">Heartbeat</button><pre id="status"></pre><div id="roster"></div><video id="remote" autoplay playsinline style="width:320px"></video><script type="module" src="/app.js"></script>`,
  );
  fs.writeFileSync(
    config,
    JSON.stringify({
      name: "herewoven-local-call-diagnostic",
      main: "scripts/cloudflare/fixtures/calling.ts",
      compatibility_date: "2026-10-13",
      compatibility_flags: ["nodejs_compat"],
      vars: {
        LOCAL_CALLING_FIXTURE: "1",
        CALLING_ENABLED: "1",
        JWT_SECRET:
          "fabricated-local-calling-only-secret-at-least-32-characters",
        NEXT_PUBLIC_APP_URL: origin,
      },
      durable_objects: {
        bindings: [{ name: "FAMILY_CALLS", class_name: "FamilyCallRoom" }],
      },
      migrations: [
        { tag: "fixture-calls-v1", new_sqlite_classes: ["FamilyCallRoom"] },
      ],
      d1_databases: [
        {
          binding: "DB",
          database_name: "calling-qa",
          database_id: "dbdbe770-f40f-4b54-9dc7-8a5b30c95927",
        },
      ],
      assets: { directory: assets, binding: "ASSETS", run_worker_first: true },
    }),
  );
  const state = path.join(temp, "state");
  run([
    "d1",
    "execute",
    "calling-qa",
    "--local",
    "--config",
    config,
    "--persist-to",
    state,
    "--command",
    `CREATE TABLE "Family" (id TEXT PRIMARY KEY, features TEXT); CREATE TABLE "User" (id TEXT PRIMARY KEY, family_id TEXT, token_version INTEGER, role TEXT); INSERT INTO "Family" VALUES ('fixture-family-a','{"calling":true}'),('fixture-family-b','{"calling":true}'); INSERT INTO "User" VALUES ('a','fixture-family-a',0,'parent'),('b','fixture-family-a',0,'parent'),('c','fixture-family-b',0,'parent');`,
  ]);
  server = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--config",
      config,
      "--persist-to",
      state,
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const pipe of [server.stdout, server.stderr])
    pipe.on("data", (chunk) => {
      serverLog = (serverLog + String(chunk)).slice(-12000);
    });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(origin, { signal: AbortSignal.timeout(500) });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    await pause(250);
  }
  if (!ready) throw Error("Local worker failed to start: " + serverLog);
  browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const pages = [];
  for (const person of ["a", "b", "c"]) {
    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
    });
    const page = await context.newPage();
    pages.push(page);
    await page.goto(origin + "/?person=" + person);
    await page.locator("#enable").click();
    await expect
      .poll(() => page.evaluate(() => window.qa?.client.getSnapshot().status), {
        timeout: 15000,
      })
      .toBe("ready");
  }
  const [a, b, c] = pages,
    snapshot = (page) => page.evaluate(() => window.qa.client.getSnapshot());
  await expect.poll(async () => (await snapshot(a)).endpoints.length).toBe(1);
  expect((await snapshot(c)).endpoints).toHaveLength(0);
  expect(await a.evaluate(() => window.qa.tracks.length)).toBe(0);
  expect(await b.evaluate(() => window.qa.tracks.length)).toBe(0);
  const active = async (page) =>
    expect
      .poll(async () => (await snapshot(page)).call?.phase, { timeout: 20000 })
      .toBe("active");
  const inbound = (page, kind) =>
    page.evaluate(
      async (kind) =>
        (await window.qa.stats())
          .filter((s) => s.type === "inbound-rtp" && s.kind === kind)
          .reduce((total, s) => total + (s.packetsReceived || 0), 0),
      kind,
    );
  await a.locator("#voice").click();
  await expect
    .poll(async () => (await snapshot(b)).call?.phase)
    .toBe("ringing");
  expect(await b.evaluate(() => window.qa.tracks.length)).toBe(0);
  await b.locator("#answer-voice").click();
  await active(a);
  await active(b);
  await expect
    .poll(() => inbound(b, "audio"), { timeout: 15000 })
    .toBeGreaterThan(0);
  expect(
    await a.evaluate(() => window.qa.tracks.some((t) => t.kind === "video")),
  ).toBe(false);
  const audioPackets = await inbound(b, "audio");
  await a.locator("#end").click();
  await expect.poll(async () => (await snapshot(b)).call).toBeNull();
  expect(
    await a.evaluate(() =>
      window.qa.tracks.every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await a.locator("#video").click();
  await expect
    .poll(async () => (await snapshot(b)).call?.phase)
    .toBe("ringing");
  await b.locator("#answer-video").click();
  await active(a);
  await active(b);
  await expect
    .poll(() => inbound(b, "video"), { timeout: 15000 })
    .toBeGreaterThan(0);
  const videoPackets = await inbound(b, "video");
  await a.locator("#camera").click();
  expect(
    await a.evaluate(() =>
      window.qa.tracks
        .filter((t) => t.kind === "video")
        .every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await a.locator("#end").click();
  await expect.poll(async () => (await snapshot(b)).call).toBeNull();
  await a.locator("#video").click();
  await expect
    .poll(async () => (await snapshot(b)).call?.phase)
    .toBe("ringing");
  await b.locator("#answer-voice").click();
  await active(a);
  await active(b);
  expect((await snapshot(a)).call.mode).toBe("voice");
  expect((await snapshot(b)).call.mode).toBe("voice");
  expect(
    await a.evaluate(() =>
      window.qa.tracks
        .filter((t) => t.kind === "video")
        .every((t) => t.readyState === "ended"),
    ),
  ).toBe(true);
  await b.evaluate(() => fetch("/__fixture/revoke", { method: "POST" }));
  await b.locator("#heartbeat").click();
  await expect.poll(async () => (await snapshot(b)).status).toBe("unavailable");
  await expect.poll(async () => (await snapshot(a)).call).toBeNull();
  for (const page of [a, b])
    expect(
      await page.evaluate(() =>
        window.qa.tracks.every((t) => t.readyState === "ended"),
      ),
    ).toBe(true);
  console.log(
    JSON.stringify({
      transport: "local workerd + native D1 + actual RTCPeerConnection",
      media: "fabricated browser audio/video",
      audioPackets,
      videoPackets,
      householdIsolation: true,
      explicitPermission: true,
      cameraStop: true,
      voiceDowngrade: true,
      revocationStopsMedia: true,
      providerOrPhysicalAcceptance: false,
    }),
  );
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
  fs.rmSync(config, { force: true });
  fs.rmSync(temp, { recursive: true, force: true });
}
