// AI feature registry and server-only boundary (#144).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AI_FEATURES,
  AI_FORBIDDEN_DATA_CLASSES,
  MODEL_RATES,
} from "../registry";
import { claudeAiDeploymentReady, canUseManagedAi } from "../flags";
import { createGeminiProvider } from "../gemini";

it("declares model, limits, schema, data classes and flag for every feature", () => {
  for (const feature of Object.values(AI_FEATURES)) {
    expect(feature.provider).toBe("claude");
    expect(feature.model).toBe("claude-haiku-5-5");
    expect(MODEL_RATES[feature.model]).toBeDefined();
    expect(feature.maxOutputTokens).toBeLessThanOrEqual(4096);
    expect(feature.flag).toBe("FAMILY_CLAUDE_AI_READY");
    for (const forbidden of AI_FORBIDDEN_DATA_CLASSES)
      expect(feature.dataClasses as readonly string[]).not.toContain(forbidden);
  }
});

it("is off unless every deployment gate is on, and children never qualify", () => {
  const on = {
    FAMILY_CLAUDE_AI_READY: "1",
    FAMILY_AI_ANTHROPIC_API_KEY: "k",
    FAMILY_AI_USAGE_READY: "1",
    FAMILY_AI_USAGE_ROLLBACK_READY: "1",
  };
  expect(claudeAiDeploymentReady(on)).toBe(true);
  expect(claudeAiDeploymentReady({})).toBe(false);
  expect(claudeAiDeploymentReady({ ...on, FAMILY_CLAUDE_AI_READY: "0" })).toBe(
    false,
  );
  expect(
    claudeAiDeploymentReady({ ...on, FAMILY_AI_PROVIDER_DISABLED: "1" }),
  ).toBe(false);
  expect(
    claudeAiDeploymentReady({ ...on, FAMILY_AI_ANTHROPIC_API_KEY: " " }),
  ).toBe(false);
  expect(
    ["parent", "teen", "child", "device", undefined].map(canUseManagedAi),
  ).toEqual([true, true, false, false, false]);
});

it("keeps Gemini blocked behind the same interface", async () => {
  await expect(
    createGeminiProvider().generateStructured({} as never),
  ).rejects.toMatchObject({
    code: "AI_PROVIDER_BLOCKED",
  });
});

it("keeps provider code and the key out of browser modules", () => {
  for (const file of [
    "src/components/assistant/SmartAddBox.tsx",
    "src/lib/smart-add-client.ts",
    "src/app/dashboard/settings/SmartHelpersSettings.tsx",
    "src/i18n/smart-add.ts",
  ]) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(source).not.toMatch(
      /@\/lib\/ai\/|@anthropic-ai\/sdk|ANTHROPIC_API_KEY|process\.env/,
    );
  }
  expect(
    readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8"),
  ).not.toMatch(/"FAMILY_CLAUDE_AI_READY":\s*"1"|FAMILY_AI_ANTHROPIC_API_KEY/);
});
