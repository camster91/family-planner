/** Isolated adopted review journals; ordinary/legacy journeys keep their defaults. */
import { defineConfig } from "@playwright/test";
import ordinary from "./playwright.config";
import { assertFixtureTargetAllowed } from "./src/lib/fixtures/guard";

assertFixtureTargetAllowed(process.env);
const server = ordinary.webServer;
if (!server || Array.isArray(server))
  throw new Error("Adopted review QA requires exactly one owned server");

const flags = [
  "QUEUE_OWNER_RECOVERY_ENABLED",
  "QUEUE_OWNER_RECOVERY_ROLLBACK_READY",
  "FAMILY_REVIEW_DOCUMENTS_READY",
  "FAMILY_REVIEW_DOCUMENTS_ROLLBACK_READY",
] as const;
for (const flag of flags) {
  if (process.env[flag] !== "1")
    throw new Error(`Isolated review-document QA requires ${flag}=1`);
}
if (process.env.E2E_REUSE_SERVER === "1")
  throw new Error("Adopted review QA must own its isolated server");

export default defineConfig({
  ...ordinary,
  projects: ordinary.projects!.map((project) => ({
    ...project,
    testMatch:
      project.name === "setup"
        ? /auth\.setup\.ts/
        : /adopted\/capture-owned\.journey\.ts/,
  })),
  webServer: {
    ...server,
    env: {
      ...server.env,
      CAPTURE_AI_KEY: "",
      // Provider-free manual review must work; never inherit paid credentials.
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_GENERATIVE_AI_API_KEY: "",
    },
  },
});
