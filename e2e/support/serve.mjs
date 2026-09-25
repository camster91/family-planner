#!/usr/bin/env node
// Starts the production Next.js server for Playwright (#155).
//
// playwright.config.ts runs this as its `webServer` command. It:
//   1. runs `npm run build` unless E2E_SKIP_BUILD=1 (CI builds in its own step);
//   2. starts `next start` on E2E_PORT with the E2E server clock shim preloaded
//      (e2e/support/server-clock.cjs), so server-rendered "today/upcoming"
//      windows line up with the fixture anchor.
//
// The shim is added to NODE_OPTIONS for the server process only, never for the
// build, so nothing time-shifted is baked into build output.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const port = process.env.E2E_PORT || "3100";

if (process.env.E2E_SKIP_BUILD !== "1") {
  const build = spawnSync("npm", ["run", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, SKIP_ENV_VALIDATION: "true" },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const shim = path.join(root, "e2e", "support", "server-clock.cjs");
const nodeOptions = [
  process.env.NODE_OPTIONS,
  `--require ${JSON.stringify(shim)}`,
]
  .filter(Boolean)
  .join(" ");

const server = spawn(
  process.execPath,
  [
    path.join(root, "node_modules", "next", "dist", "bin", "next"),
    "start",
    "-p",
    port,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      E2E_ALLOW_SERVER_CLOCK: "1",
    },
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
