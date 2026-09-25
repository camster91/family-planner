/**
 * Playwright E2E, visual and accessibility smoke config (#155).
 * Commands, env and baseline policy: docs/testing/E2E.md.
 */
import { defineConfig, devices, type Project } from "@playwright/test";
import {
  E2E_ANCHOR,
  E2E_BASE_URL,
  E2E_DEFAULT_JWT_SECRET,
  E2E_LOCALE,
  E2E_PORT,
  E2E_TIMEZONE,
} from "./e2e/support/env";

const isCI = Boolean(process.env.CI);
// Overridable so CI can keep separate artifacts for its journeys and visual runs.
const reportDir = process.env.E2E_REPORT_DIR || "playwright-report";
const outputDir = process.env.E2E_OUTPUT_DIR || "test-results/e2e";

/**
 * Representative sizes from AGENTS.md "Responsive QA baseline" and
 * docs/testing/QA_MATRIX.md. Project names are part of the snapshot file names,
 * so renaming one orphans its baselines.
 */
const viewports: Array<{
  name: string;
  width: number;
  height: number;
  touch: boolean;
  mobile: boolean;
}> = [
  { name: "phone-390x844", width: 390, height: 844, touch: true, mobile: true },
  { name: "phone-430x932", width: 430, height: 932, touch: true, mobile: true },
  {
    name: "tablet-portrait-800x1280",
    width: 800,
    height: 1280,
    touch: true,
    mobile: false,
  },
  {
    name: "fridge-landscape-1280x800",
    width: 1280,
    height: 800,
    touch: true,
    mobile: false,
  },
  {
    name: "tablet-large-1920x1200",
    width: 1920,
    height: 1200,
    touch: true,
    mobile: false,
  },
  {
    name: "desktop-1366x768",
    width: 1366,
    height: 768,
    touch: false,
    mobile: false,
  },
];

const viewportProjects: Project[] = viewports.map((v, i) => ({
  name: v.name,
  dependencies: ["setup"],
  testIgnore: /.*\.setup\.ts/,
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: v.width, height: v.height },
    // 1x keeps baselines small and identical across hosts with different DPR.
    deviceScaleFactor: 1,
    hasTouch: v.touch,
    isMobile: v.mobile,
    // A distinct TEST-NET-2 client address per project, so each project gets its
    // own login rate-limit bucket (src/lib/client-ip.ts reads X-Forwarded-For).
    extraHTTPHeaders: { "X-Forwarded-For": `198.51.100.${10 + i}` },
  },
}));

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.(spec|setup)\.ts/,
  outputDir,
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  // One worker: the specs share one seeded database and one login rate-limit bucket.
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Absorbs sub-pixel anti-aliasing noise only; layout/colour changes exceed it.
      maxDiffPixelRatio: 0.002,
    },
  },
  reporter: isCI
    ? [
        ["list"],
        ["html", { open: "never", outputFolder: reportDir }],
        ["github"],
      ]
    : [["list"], ["html", { open: "never", outputFolder: reportDir }]],
  use: {
    baseURL: E2E_BASE_URL,
    locale: E2E_LOCALE,
    timezoneId: E2E_TIMEZONE,
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    ...viewportProjects,
  ],
  webServer: {
    command: "node e2e/support/serve.mjs",
    url: `${E2E_BASE_URL}/api/health`,
    // A server not started by serve.mjs lacks the clock shim and renders
    // different "upcoming" data, so reuse is opt-in only.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    // Includes `npm run build` unless E2E_SKIP_BUILD=1.
    timeout: 10 * 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      E2E_PORT: String(E2E_PORT),
      E2E_SERVER_NOW: E2E_ANCHOR.toISOString(),
      TZ: E2E_TIMEZONE,
      JWT_SECRET: process.env.JWT_SECRET || E2E_DEFAULT_JWT_SECRET,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
