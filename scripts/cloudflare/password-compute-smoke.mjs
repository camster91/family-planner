import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// Local-only smoke. The generated Wrangler config is disposable and is never
// the application's production config or a deployable environment.
const root = fileURLToPath(new URL("../../", import.meta.url));
const scratch = await mkdtemp(
  path.join(tmpdir(), "herewoven-password-compute-"),
);
const configPath = path.join(
  root,
  `.wrangler-password-compute-${process.pid}.json`,
);
const state = path.join(scratch, "state");
const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
let worker;
let workerOutput = "";
try {
  await writeFile(
    configPath,
    JSON.stringify({
      name: "herewoven-local-password-compute",
      main: path.join(
        root,
        "scripts/cloudflare/fixtures/password-compute-worker.ts",
      ),
      tsconfig: "tsconfig.json",
      compatibility_date: "2026-10-13",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      preview_urls: false,
      durable_objects: {
        bindings: [
          { name: "PASSWORD_COMPUTE", class_name: "LocalPasswordCompute" },
        ],
      },
      migrations: [{ tag: "v1", new_sqlite_classes: ["LocalPasswordCompute"] }],
    }),
  );
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
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
  worker.stdout.on("data", (chunk) => {
    workerOutput += String(chunk);
  });
  worker.stderr.on("data", (chunk) => {
    workerOutput += String(chunk);
  });
  let response;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (worker.exitCode !== null)
      throw new Error("Local Worker exited before password compute startup");
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.ok(response, "Local password compute Worker did not become ready");
  assert.equal(
    response.status,
    200,
    "Local password compute Worker health failed",
  );
  const resultResponse = await fetch(`http://127.0.0.1:${port}/run`, {
    signal: AbortSignal.timeout(60_000),
  });
  const result = await resultResponse.json();
  assert.equal(resultResponse.status, 200, JSON.stringify(result));
  assert.deepEqual(result, {
    bcrypt12: true,
    password: true,
    pin: true,
    boundedShards: true,
    missingBindingHonest: true,
  });
  console.log(JSON.stringify(result));
} catch (error) {
  if (workerOutput) console.error(workerOutput.slice(-6000));
  throw error;
} finally {
  if (worker && worker.exitCode === null) {
    const stopped = new Promise((resolve) => worker.once("exit", resolve));
    worker.kill("SIGTERM");
    await stopped;
  }
  await rm(scratch, { recursive: true, force: true });
  await rm(configPath, { force: true });
}
