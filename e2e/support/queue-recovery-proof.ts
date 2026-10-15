/** Bind synthetic recovery captures to the actual compiled source and runtime. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { expect } from "./test";

export async function preserveQueueRecoveryProof(
  page: Page,
  info: TestInfo,
  surface: "person" | "device",
  locale: "en" | "es",
  images: string[],
) {
  const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
  }).trim();
  expect(() =>
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", "src", "e2e"], {
      stdio: "ignore",
    }),
  ).not.toThrow();
  expect(process.env.RELEASE_SHA?.trim()).toBe(sourceHead);
  const response = await page.request.get("/api/version");
  expect(response.status()).toBe(200);
  const runtime = await response.json();
  expect(runtime.commit).toBe(sourceHead);
  const captures = images.map((name) => ({
    name,
    sha256: createHash("sha256")
      .update(fs.readFileSync(info.outputPath(name)))
      .digest("hex"),
  }));
  fs.writeFileSync(
    info.outputPath(`${surface}-${locale}-queue-recovery-proof.json`),
    JSON.stringify(
      {
        sourceHead,
        sourceTree,
        runtime,
        surface,
        locale,
        project: info.project.name,
        assertionsPassed: true,
        captures,
      },
      null,
      2,
    ),
  );
}
