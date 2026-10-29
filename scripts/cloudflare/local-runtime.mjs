#!/usr/bin/env node
/**
 * Run a retained Cloudflare runtime archive locally.
 *
 * This harness is intentionally separate from the application build. It
 * consumes the Wrangler multipart bundle produced by the manual cloudflare
 * workflow, restores only its static assets, and runs the real OpenNext
 * Worker in Miniflare/workerd with disposable D1/R2 resources. The private
 * password-compute Worker is built from its small Worker entrypoint with a
 * local Wrangler dry-run and is connected through a real service binding.
 *
 * No remote bindings, provider credentials, mail transport, or external
 * network are enabled. The only URL exposed is a loopback address.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  lstat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WRANGLER = path.join(ROOT, "node_modules/wrangler/bin/wrangler.js");
const LOCAL_DATABASE_ID = "00000000-0000-0000-0000-000000000001";
const LOCAL_DATABASE_NAME = "herewoven-local-runtime";
const LOCAL_UPLOAD_BUCKET = "herewoven-local-runtime-uploads";
const FAKE_JWT_SECRET =
  "fabricated-local-runtime-jwt-secret-not-production-0123456789";
const PRIVATE_PASSWORD_COMPUTE_FILES = [
  "src/cloudflare/password-compute-worker.ts",
  "src/lib/cloudflare/password-compute-do.ts",
  "src/lib/cloudflare/local-password-compute.ts",
  "wrangler.password-compute.jsonc",
  "package-lock.json",
];

function usage() {
  console.log(
    [
      "Usage: node scripts/cloudflare/local-runtime.mjs --runtime <archive>",
      "",
      "The archive must be the opt-in cloudflare-local-runtime artifact.",
      "The process stays alive until SIGINT/SIGTERM and prints one JSON URL line.",
    ].join("\n"),
  );
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  usage();
  process.exit(0);
}

const runtimeArchive = argument("--runtime");
if (!runtimeArchive) {
  usage();
  process.exit(2);
}

const safeChildEnv = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? tmpdir(),
  TMPDIR: process.env.TMPDIR ?? tmpdir(),
  LANG: process.env.LANG ?? "C.UTF-8",
  NODE_ENV: "production",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_CI_DISABLE_CONFIG_WATCHING: "true",
};

function runWrangler(args, options = {}) {
  try {
    return execFileSync(process.execPath, [WRANGLER, ...args], {
      cwd: ROOT,
      env: safeChildEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr ?? "").trim()
        : "";
    throw new Error(
      `Local Wrangler operation failed${stderr ? `: ${stderr.slice(-2000)}` : ""}`,
    );
  }
}

function normalizedArchiveName(value) {
  const name = value.replace(/^\.\//, "").replace(/\/$/, "");
  if (!name || name.startsWith("/") || name.includes("\\")) return null;
  const pieces = name.split("/");
  if (pieces.includes("..")) return null;
  return name;
}

function allowedArchiveName(name) {
  return (
    name === "worker.bundle" ||
    name === "source.json" ||
    name === ".open-next/assets" ||
    name.startsWith(".open-next/assets/")
  );
}

function assertArchiveEntryTypes(archive) {
  // `tar -tzf` only reports names. Inspect the mode column before extraction
  // as well, so a link/device/FIFO cannot be materialised and then inspected
  // after it has already crossed the scratch-directory boundary.
  const details = execFileSync("tar", ["-tvzf", archive], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  for (const line of details.split(/\r?\n/).filter(Boolean)) {
    const type = line[0];
    if (type !== "-" && type !== "d")
      throw new Error(
        "Runtime archive may contain only regular files and directories",
      );
  }
}

async function extractRuntimeArchive(archive, destination) {
  const listing = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const entries = listing
    .split(/\r?\n/)
    .map(normalizedArchiveName)
    .filter(Boolean);
  if (!entries.includes("worker.bundle") || !entries.includes("source.json"))
    throw new Error("Runtime archive is missing worker.bundle or source.json");
  if (!entries.some((entry) => entry.startsWith(".open-next/assets")))
    throw new Error("Runtime archive is missing .open-next/assets");
  if (entries.some((entry) => !allowedArchiveName(entry)))
    throw new Error(
      "Runtime archive contains files outside the allowed runtime set",
    );
  assertArchiveEntryTypes(archive);

  await mkdir(destination, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", destination], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const required of [
    "worker.bundle",
    "source.json",
    ".open-next/assets",
  ]) {
    const resolved = path.join(destination, required);
    const info = await lstat(resolved);
    if (info.isSymbolicLink())
      throw new Error("Runtime archive entries may not contain symbolic links");
    if (required === ".open-next/assets" ? !info.isDirectory() : !info.isFile())
      throw new Error(
        `Runtime archive entry is not the expected type: ${required}`,
      );
  }
  await assertSafeAssetTree(path.join(destination, ".open-next/assets"));
}

async function assertSafeAssetTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Runtime assets may not contain symbolic links");
    if (entry.isDirectory()) {
      if (entry.name === "node_modules")
        throw new Error("Runtime assets may not contain node_modules");
      await assertSafeAssetTree(full);
      continue;
    }
    if (!entry.isFile())
      throw new Error("Runtime assets contain an unsupported file type");
    if (
      entry.name.endsWith(".map") ||
      entry.name === ".env" ||
      entry.name.startsWith(".env.")
    )
      throw new Error(
        "Runtime assets may not contain maps or environment files",
      );
  }
}

async function parseMultipartBundle(bundlePath) {
  const bundle = await readFile(bundlePath);
  const firstLine = bundle.indexOf(0x0a);
  if (firstLine < 3 || bundle[0] !== 0x2d || bundle[1] !== 0x2d)
    throw new Error("Expected a Wrangler multipart worker.bundle");
  const boundary = bundle.subarray(2, firstLine).toString("utf8");
  const response = new Response(bundle, {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  const form = await response.formData();
  const metadataPart = form.get("metadata");
  if (typeof metadataPart !== "string")
    throw new Error("Worker bundle metadata is missing");
  let metadata;
  try {
    metadata = JSON.parse(metadataPart);
  } catch {
    throw new Error("Worker bundle metadata is invalid JSON");
  }
  if (typeof metadata.main_module !== "string")
    throw new Error("Only module-format Worker bundles are supported");

  const modules = [];
  for (const [name, value] of form.entries()) {
    if (name === "metadata" || !(value instanceof Blob)) continue;
    if (value.type === "application/source-map") continue;
    const type =
      value.type === "application/javascript+module"
        ? "ESModule"
        : value.type === "application/javascript"
          ? "CommonJS"
          : value.type === "application/wasm"
            ? "CompiledWasm"
            : value.type === "application/octet-stream"
              ? "Data"
              : value.type === "text/plain"
                ? "Text"
                : null;
    if (!type)
      throw new Error(`Unsupported Worker bundle part type: ${value.type}`);
    modules.push({
      type,
      path: name,
      contents: new Uint8Array(await value.arrayBuffer()),
      mimeType: value.type,
    });
  }
  const main = modules.find((module) => module.path === metadata.main_module);
  if (!main) throw new Error("Worker bundle main module is missing");
  return {
    metadata,
    modules: [main, ...modules.filter((module) => module !== main)],
  };
}

function metadataBindings(bundle, scratch, overrides = {}) {
  const bindings = {};
  const textBlobBindings = {};
  const dataBlobBindings = {};
  const wasmBindings = {};
  const d1Names = [];
  const r2Names = [];
  const serviceNames = [];
  const durableObjects = {};
  const assetsNames = [];

  for (const binding of Array.isArray(bundle.metadata.bindings)
    ? bundle.metadata.bindings
    : []) {
    if (!binding || typeof binding.name !== "string") continue;
    switch (binding.type) {
      case "plain_text":
        bindings[binding.name] = binding.text ?? "";
        break;
      case "json":
        bindings[binding.name] = binding.json ?? null;
        break;
      case "secret_text":
        // Do not restore secret values from an artifact. Known local-only
        // secrets are supplied below as fabricated values.
        break;
      case "text_blob": {
        const part = bundle.modules.find(
          (module) => module.path === binding.part,
        );
        if (!part)
          throw new Error(`Text binding part is missing: ${binding.name}`);
        const file = path.join(scratch, "bindings", `${binding.name}.txt`);
        textBlobBindings[binding.name] = file;
        writeFileSync(file, part.contents);
        break;
      }
      case "data_blob": {
        const part = bundle.modules.find(
          (module) => module.path === binding.part,
        );
        if (!part)
          throw new Error(`Data binding part is missing: ${binding.name}`);
        dataBlobBindings[binding.name] = part.contents;
        break;
      }
      case "wasm_module": {
        const part = bundle.modules.find(
          (module) => module.path === binding.part,
        );
        if (!part)
          throw new Error(`Wasm binding part is missing: ${binding.name}`);
        wasmBindings[binding.name] = part.contents;
        break;
      }
      case "d1":
        d1Names.push(binding.name);
        break;
      case "r2_bucket":
        r2Names.push(binding.name);
        break;
      case "service":
        serviceNames.push(binding.name);
        break;
      case "durable_object_namespace":
        durableObjects[binding.name] = {
          className: binding.class_name,
          useSQLite: true,
        };
        break;
      case "assets":
        assetsNames.push(binding.name);
        break;
      case "inherit":
        break;
      default:
        // Unsupported Cloudflare products stay unbound rather than being
        // silently represented by a remote or provider-backed fake.
        break;
    }
  }

  Object.assign(bindings, overrides);
  return {
    bindings,
    textBlobBindings,
    dataBlobBindings,
    wasmBindings,
    d1Names,
    r2Names,
    serviceNames,
    durableObjects,
    assetsName: assetsNames[0] ?? null,
  };
}

async function makeWorkerOptions(bundle, name, scratch, overrides = {}) {
  const bindingScratch = path.join(scratch, "binding-files");
  await mkdir(bindingScratch, { recursive: true });
  const configured = metadataBindings(bundle, bindingScratch, overrides);
  const appOptions = {
    name,
    rootPath: scratch,
    modulesRoot: scratch,
    modules: bundle.modules.map(({ type, path: modulePath, contents }) => ({
      type,
      path: modulePath,
      contents,
    })),
    compatibilityDate: bundle.metadata.compatibility_date ?? "2026-10-13",
    compatibilityFlags: bundle.metadata.compatibility_flags ?? [
      "nodejs_compat",
    ],
    bindings: configured.bindings,
    textBlobBindings: configured.textBlobBindings,
    dataBlobBindings: configured.dataBlobBindings,
    wasmBindings: configured.wasmBindings,
    d1Databases: Object.fromEntries(
      configured.d1Names.map((binding) => [binding, LOCAL_DATABASE_ID]),
    ),
    r2Buckets: Object.fromEntries(
      configured.r2Names.map((binding) => [binding, LOCAL_UPLOAD_BUCKET]),
    ),
    durableObjects: configured.durableObjects,
    serviceBindings: {},
    assets: configured.assetsName
      ? {
          directory: path.join(scratch, "runtime", ".open-next/assets"),
          binding: configured.assetsName,
          run_worker_first: true,
          routerConfig: { has_user_worker: true },
        }
      : undefined,
    unsafeRegisterWorker: false,
  };
  return { options: appOptions, serviceNames: configured.serviceNames };
}

function localMiniflareOptions(instance, workers) {
  const options = convertV4MiniflareOptions({
    ...instance,
    workers,
  });
  // Miniflare 5 exposes outbound interception on each worker's dev config,
  // rather than accepting the v4 `outboundService.network` option. Returning
  // a response here is deliberate: it prevents a local fixture from ever
  // reaching a recipe, calendar, mail, or other external provider.
  for (const worker of options.workers) {
    worker.dev.outboundService = {
      type: "fetcher",
      handler: async () =>
        new Response("External network disabled in local runtime", {
          status: 403,
        }),
    };
    worker.dev.unsafeRegisterWorker = false;
  }
  return options;
}

async function buildPasswordComputeBundle(scratch) {
  const configPath = path.join(
    ROOT,
    `.wrangler-local-password-${process.pid}.json`,
  );
  const bundlePath = path.join(scratch, "password-compute.bundle");

  await writeFile(
    configPath,
    JSON.stringify({
      name: "herewoven-local-password-compute",
      main: path.join(ROOT, "src/cloudflare/password-compute-worker.ts"),
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
  try {
    runWrangler([
      "deploy",
      "--dry-run",
      "--config",
      configPath,
      "--outfile",
      bundlePath,
    ]);
    return bundlePath;
  } finally {
    await rm(configPath, { force: true });
  }
}

async function verifyPrivatePasswordCompute(source) {
  const manifest = source.runtimeArtifact?.privatePasswordCompute;
  if (
    !manifest ||
    manifest.algorithm !== "sha256" ||
    !manifest.files ||
    typeof manifest.files !== "object" ||
    Array.isArray(manifest.files)
  )
    throw new Error("Runtime archive is missing private Worker provenance");

  const actualFiles = Object.keys(manifest.files).sort();
  const expectedFiles = [...PRIVATE_PASSWORD_COMPUTE_FILES].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles))
    throw new Error("Private Worker provenance file set is invalid");

  for (const relativePath of PRIVATE_PASSWORD_COMPUTE_FILES) {
    const expected = manifest.files[relativePath];
    if (typeof expected !== "string" || !/^[0-9a-f]{64}$/i.test(expected))
      throw new Error(
        `Private Worker provenance hash is invalid: ${relativePath}`,
      );
    const filePath = path.join(ROOT, relativePath);
    const info = await lstat(filePath);
    if (!info.isFile())
      throw new Error(
        `Private Worker provenance file is not regular: ${relativePath}`,
      );
    const actual = createHash("sha256")
      .update(await readFile(filePath))
      .digest("hex");
    if (actual !== expected.toLowerCase())
      throw new Error(`Private Worker provenance mismatch: ${relativePath}`);
  }
}

async function applyMigrations(scratch) {
  const configPath = path.join(scratch, "runtime-migrations.wrangler.json");
  const entry = path.join(scratch, "migration-worker.mjs");
  const state = path.join(scratch, "resources");
  await writeFile(
    entry,
    "export default { fetch() { return new Response(null, { status: 404 }) } }\n",
  );
  await writeFile(
    configPath,
    JSON.stringify({
      name: "herewoven-local-runtime-migrations",
      main: entry,
      compatibility_date: "2026-10-13",
      compatibility_flags: ["nodejs_compat"],
      workers_dev: false,
      preview_urls: false,
      d1_databases: [
        {
          binding: "DB",
          database_name: LOCAL_DATABASE_NAME,
          database_id: LOCAL_DATABASE_ID,
          migrations_dir: path.join(ROOT, "database/cloudflare"),
        },
      ],
    }),
  );
  runWrangler([
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
  // Wrangler stores local resources under its versioned v3 directory.
  // Miniflare expects that resource root directly.
  return path.join(state, "v3");
}

async function waitForSignal() {
  await new Promise((resolve) => {
    const done = () => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

const scratch = await mkdtemp(path.join(tmpdir(), "herewoven-local-runtime-"));
let app;
let passwordCompute;
try {
  const runtimeDirectory = path.join(scratch, "runtime");
  await extractRuntimeArchive(path.resolve(runtimeArchive), runtimeDirectory);
  const source = JSON.parse(
    await readFile(path.join(runtimeDirectory, "source.json"), "utf8"),
  );
  if (source.deployment !== false || source.runtimeArtifact?.requested !== true)
    throw new Error(
      "Runtime archive source metadata is not an opt-in local artifact",
    );
  const sourceSha = /^[0-9a-f]{40}$/i.test(source.sha ?? "")
    ? source.sha
    : null;
  await verifyPrivatePasswordCompute(source);

  const databaseState = await applyMigrations(scratch);
  const appBundle = await parseMultipartBundle(
    path.join(runtimeDirectory, "worker.bundle"),
  );
  const passwordBundlePath = await buildPasswordComputeBundle(scratch);
  const passwordBundle = await parseMultipartBundle(passwordBundlePath);

  const passwordConfigured = await makeWorkerOptions(
    passwordBundle,
    "herewoven-password-compute",
    scratch,
    {
      NODE_ENV: "production",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1",
    },
  );
  passwordCompute = new Miniflare(
    localMiniflareOptions(
      {
        host: "127.0.0.1",
        port: 0,
        resourcePersistencePath: path.join(scratch, "password-resources"),
        resourceTmpPath: path.join(scratch, "password-tmp"),
        telemetry: { enabled: false },
      },
      [passwordConfigured.options],
    ),
  );

  const appConfigured = await makeWorkerOptions(
    appBundle,
    "herewoven-local-runtime",
    scratch,
    {
      JWT_SECRET: FAKE_JWT_SECRET,
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1",
      HEREWOVEN_STORAGE: "d1",
      MAIL_TRANSPORT: "off",
      FAMILY_AI_PROVIDER_DISABLED: "1",
      FAMILY_FOOD_AI_READY: "0",
      CAPTURE_AI_SETTINGS_ENABLED: "0",
      INVENTORY_CAPTURE_DOCUMENTS_ENABLED: "0",
      WEATHER_ENABLED: "0",
      CRON_SECRET: "fabricated-local-runtime-cron-secret",
      RELEASE_SHA: sourceSha ?? "local-runtime",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  );
  appConfigured.options.d1Databases = { DB: LOCAL_DATABASE_ID };
  appConfigured.options.r2Buckets = { UPLOADS: LOCAL_UPLOAD_BUCKET };
  appConfigured.options.resourcePersistencePath = databaseState;
  appConfigured.options.serviceBindings = Object.fromEntries(
    appConfigured.serviceNames.map((name) => [
      name,
      async (request) => {
        if (name === "PASSWORD_COMPUTE")
          return passwordCompute.dispatchFetch(request);
        if (name === "WORKER_SELF_REFERENCE") return app.dispatchFetch(request);
        return new Response("Local service binding is unavailable", {
          status: 503,
        });
      },
    ]),
  );
  app = new Miniflare(
    localMiniflareOptions(
      {
        host: "127.0.0.1",
        port: 0,
        resourcePersistencePath: databaseState,
        resourceTmpPath: path.join(scratch, "runtime-tmp"),
        telemetry: { enabled: false },
      },
      [appConfigured.options],
    ),
  );

  const ready = await app.ready;
  const url = new URL(ready);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  console.log(
    JSON.stringify({
      url: url.href,
      sourceSha,
      local: true,
      host: "127.0.0.1",
      externalEgress: "denied",
      email: "off",
      providerCalls: "disabled",
    }),
  );
  await waitForSignal();
} finally {
  await app?.dispose();
  await passwordCompute?.dispose();
  await rm(scratch, { recursive: true, force: true });
}
