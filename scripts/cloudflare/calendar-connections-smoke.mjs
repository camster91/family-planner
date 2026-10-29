import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Disposable D1/provider fixture. It never reads credentials or production
// config and does not contact Google, Microsoft, or any public endpoint.
const root = fileURLToPath(new URL("../../", import.meta.url));
const scratch = await mkdtemp(
  path.join(tmpdir(), "herewoven-calendar-connections-"),
);
const configPath = path.join(
  root,
  `.wrangler-calendar-connections-${process.pid}.json`,
);
const state = path.join(scratch, "state");
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
const logPath = path.join(scratch, "worker.log");
let worker;
const run = (args) =>
  execFileSync(process.execPath, [wrangler, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  await writeFile(
    configPath,
    JSON.stringify({
      name: "herewoven-local-calendar-connections",
      main: path.join(
        root,
        "scripts/cloudflare/fixtures/calendar-connections-worker.ts",
      ),
      tsconfig: "tsconfig.json",
      compatibility_date: "2026-10-13",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      preview_urls: false,
      d1_databases: [
        {
          binding: "DB",
          database_name: "local-calendar-connections",
          database_id: "00000000-0000-0000-0000-000000000003",
          migrations_dir: path.join(root, "database/cloudflare"),
        },
      ],
    }),
  );
  run([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    configPath,
    "--persist-to",
    state,
  ]);
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const log = createWriteStream(logPath);
  worker = spawn(
    process.execPath,
    [
      wrangler,
      "dev",
      "--local",
      "--config",
      configPath,
      "--persist-to",
      state,
      "--port",
      String(port),
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  worker.stdout.pipe(log);
  worker.stderr.pipe(log);
  let ready;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (worker.exitCode !== null)
      throw new Error("Local Worker exited before calendar fixture startup");
    try {
      ready = await fetch(`http://127.0.0.1:${port}/run`, {
        signal: AbortSignal.timeout(2000),
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.ok(ready, "Local calendar fixture Worker did not become ready");
  const result = await ready.json();
  assert.equal(ready.status, 200, JSON.stringify(result));
  assert.deepEqual(result, {
    oauthPkce: true,
    singleUse: true,
    connectionPrivacy: true,
    reconnectRefreshRetention: true,
    providerPull: true,
    providerPush: true,
    feed: true,
    disconnectIsolation: true,
  });
  console.log(JSON.stringify(result));
} catch (error) {
  let output = "";
  try {
    output = await readFile(logPath, "utf8");
  } catch {
    /* startup may fail before log exists */
  }
  console.error(output.slice(-6000));
  throw error;
} finally {
  if (worker && worker.exitCode === null) {
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGTERM");
    await stopped;
  }
  await rm(configPath, { force: true });
  await rm(scratch, { recursive: true, force: true });
}
