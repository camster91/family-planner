#!/usr/bin/env node
/**
 * Produce bounded Cloudflare readiness metadata without copying bundle content.
 *
 * This script only records file sizes/counts and the numeric summary emitted by
 * `wrangler check startup --worker`. The temporary CPU profile is deleted before
 * the script exits; compiled JavaScript, source maps, provider names and secrets
 * are never written to the readiness artifact.
 */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const ROOT = process.cwd();
const LIMIT_BYTES = 64 * 1024 * 1024;
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value.startsWith("--")) continue;
  const [key, inline] = value.slice(2).split("=", 2);
  const next = inline ?? process.argv[index + 1];
  if (inline === undefined) index += 1;
  if (!next || next.startsWith("--"))
    throw new Error(`Missing value for --${key}`);
  args.set(key, next);
}

const bundleFile = path.resolve(
  ROOT,
  args.get("bundle-file") ?? "cloudflare-readiness/worker.bundle",
);
const assetsDir = path.resolve(
  ROOT,
  args.get("assets-dir") ?? ".open-next/assets",
);
const summaryOut = path.resolve(
  ROOT,
  args.get("summary-out") ?? "cloudflare-readiness/bundle-summary.json",
);
const startupOut = path.resolve(
  ROOT,
  args.get("startup-out") ?? "cloudflare-readiness/startup-summary.json",
);
const runtimeArtifactRetained = args.get("runtime-artifact-retained") === "true";
const wrangler = path.resolve(ROOT, "node_modules/wrangler/bin/wrangler.js");

async function walk(directory) {
  try {
    await fs.access(directory);
  } catch {
    return [];
  }
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.isFile()) {
      const stat = await fs.stat(full);
      files.push({
        path: path.relative(assetsDir, full).split(path.sep).join("/"),
        bytes: stat.size,
      });
    }
  }
  return files;
}

function writeJson(file, value) {
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

function sourceSha() {
  return /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA ?? "")
    ? process.env.GITHUB_SHA
    : null;
}

async function readBundleParts(file) {
  const bundle = await fs.readFile(file);
  const firstLine = bundle.indexOf(0x0a);
  if (firstLine < 3 || bundle[0] !== 0x2d || bundle[1] !== 0x2d) {
    throw new Error(`Expected Wrangler multipart bundle at ${file}`);
  }
  const boundary = bundle.subarray(2, firstLine).toString("utf8");
  const response = new Response(bundle, {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  });
  const form = await response.formData();
  return [...form.entries()].map(([name, value]) => ({
    name,
    bytes: typeof value === "string" ? Buffer.byteLength(value) : value.size,
    contentType: typeof value === "string" ? null : value.type,
    blob: typeof value !== "string",
  }));
}

function parseMilliseconds(output, label) {
  const match = output.match(
    new RegExp(`${label}:\\s*([0-9]+(?:\\.[0-9]+)?)\\s*ms`, "i"),
  );
  return match ? Number(match[1]) : null;
}

function parseCount(output) {
  const match = output.match(/Samples:\s*([0-9]+)/i);
  return match ? Number(match[1]) : null;
}

async function main() {
  const bundleParts = await readBundleParts(bundleFile);
  const uploadModules = bundleParts.filter(
    (part) => part.blob && part.contentType !== "application/source-map",
  );
  if (!uploadModules.length)
    throw new Error("No upload modules found in Wrangler dry-run bundle");
  const assets = await walk(assetsDir);
  const largestAssets = [...assets]
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, 10)
    .map((file) => ({ path: file.path, bytes: file.bytes }));
  const uploadBytes = uploadModules.reduce(
    (total, part) => total + part.bytes,
    0,
  );
  writeJson(summaryOut, {
    schema: "herewoven/cloudflare-bundle-summary@1",
    sourceSha: sourceSha(),
    deployment: false,
    contentsIncluded: false,
    compiledContentsRetained: false,
    runtimeArtifact: {
      retained: runtimeArtifactRetained,
      retentionDays: runtimeArtifactRetained ? 7 : null,
      contents: runtimeArtifactRetained
        ? ["worker.bundle", ".open-next/assets", "source.json"]
        : [],
    },
    uploadModules: {
      count: uploadModules.length,
      bytes: uploadBytes,
      mebibytes: Number((uploadBytes / 1024 / 1024).toFixed(3)),
      limitBytes: LIMIT_BYTES,
      limitMebibytes: 64,
      within64MiB: uploadBytes <= LIMIT_BYTES,
    },
    assets: {
      directory: path.relative(ROOT, assetsDir).split(path.sep).join("/"),
      present: assets.length > 0,
      count: assets.length,
      bytes: assets.reduce((total, file) => total + file.bytes, 0),
      largest: largestAssets,
    },
  });

  if (uploadBytes > LIMIT_BYTES)
    throw new Error("Worker upload exceeds the 64 MiB limit");

  const temporaryProfile = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "herewoven-startup-")),
    "worker-startup.cpuprofile",
  );
  let output = "";
  let status = 1;
  try {
    const result = spawnSync(
      process.execPath,
      [
        wrangler,
        "check",
        "startup",
        "--worker",
        bundleFile,
        "--outfile",
        temporaryProfile,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    status = result.status ?? 1;
    if (status !== 0)
      throw new Error(`wrangler check startup failed with exit ${status}`);
  } finally {
    await fs.rm(path.dirname(temporaryProfile), {
      recursive: true,
      force: true,
    });
  }
  writeJson(startupOut, {
    schema: "herewoven/cloudflare-startup-summary@1",
    sourceSha: sourceSha(),
    execution: "local",
    edge: false,
    deployment: false,
    profileArtifactRetained: false,
    workerBundle: path.relative(ROOT, bundleFile).split(path.sep).join("/"),
    profileWindowMs: parseMilliseconds(output, "Profile window"),
    sampledTimeMs: parseMilliseconds(output, "Sampled time"),
    activeTimeMs: parseMilliseconds(output, "Active"),
    idleTimeMs: parseMilliseconds(output, "Idle"),
    sampleCount: parseCount(output),
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
