import {
  isAiUsageAdopted,
  isAiUsageReady,
  reserveAiUsage,
} from "../ai-usage-server";
/** Authored/unrun. Exact arithmetic and non-content transport contracts. */
import {
  aiUsagePolicy,
  defaultAiUsagePolicy,
  estimateAiMicrousd,
  reportedTokenCount,
  usdToMicrousd,
  microusdToUsd,
} from "../ai-usage-contract";
import { structuredAssistantReply, CaptureError } from "../capture";
const previousPause = process.env.FAMILY_AI_PROVIDER_DISABLED;
beforeAll(() => {
  delete process.env.FAMILY_AI_PROVIDER_DISABLED;
});
afterAll(() => {
  if (previousPause === undefined)
    delete process.env.FAMILY_AI_PROVIDER_DISABLED;
  else process.env.FAMILY_AI_PROVIDER_DISABLED = previousPause;
});
const config = {
  apiKey: "fabricated-fixture-key",
  model: "fixture",
  baseUrl: "https://example.invalid",
  userSuppliedUrl: false,
};
const chat = {
  messages: [{ role: "user", content: "PRIVATE_PHRASE" }],
  localNow: "now",
  timeZone: "UTC",
};
it("keeps unknown estimates distinct from exact zero and uses integer micro-USD", () => {
  expect(estimateAiMicrousd(100, 200, defaultAiUsagePolicy)).toBeNull();
  const policy = {
    ...defaultAiUsagePolicy,
    inputRateMicrousdPerMillion: "1250000",
    outputRateMicrousdPerMillion: "2500000",
  };
  expect(estimateAiMicrousd(100, 200, policy)).toBe("625");
  expect(
    estimateAiMicrousd(1, 0, { ...policy, inputRateMicrousdPerMillion: "1" }),
  ).toBe("1");
  expect(estimateAiMicrousd(0, 0, policy)).toBe("0");
  expect(usdToMicrousd("0.000001")).toBe("1");
  expect(usdToMicrousd("1.250001")).toBe("1250001");
  expect(microusdToUsd("10000000")).toBe("10");
  expect(usdToMicrousd("1e6")).toBeNull();
  expect(
    aiUsagePolicy.safeParse({
      ...defaultAiUsagePolicy,
      monthlyBudgetMicrousd: "1",
    }).success,
  ).toBe(false);
  for (const invalid of ["123", -1, 1.5, Infinity, 100000001])
    expect(reportedTokenCount(invalid)).toBeNull();
});
it("refuses a quota-denied call before any provider request", async () => {
  global.fetch = jest.fn() as never;
  const observer = {
    start: jest.fn(async () => {
      throw new CaptureError("Quota reached", 429);
    }),
    reported: jest.fn(),
    failed: jest.fn(),
  };
  await expect(
    structuredAssistantReply(
      chat,
      config,
      "policy",
      undefined,
      undefined,
      observer,
    ),
  ).rejects.toThrow("Quota reached");
  expect(global.fetch).not.toHaveBeenCalled();
  expect(observer.reported).not.toHaveBeenCalled();
});
it("reports only validated numeric usage, never provider text or arbitrary metadata", async () => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      usage: {
        prompt_tokens: 12,
        completion_tokens: "wrong",
        prompt: "PRIVATE_PROVIDER_ECHO",
        api_key: "PRIVATE_PROVIDER_KEY",
      },
      choices: [
        {
          message: {
            content: JSON.stringify({ reply: "Review", action: null }),
          },
        },
      ],
    }),
  })) as never;
  const observer = {
    start: jest.fn(async () => {}),
    reported: jest.fn(),
    failed: jest.fn(),
  };
  await structuredAssistantReply(
    chat,
    config,
    "policy",
    undefined,
    undefined,
    observer,
  );
  expect(observer.start).toHaveBeenCalledWith({
    inputBytes: expect.any(Number),
    maxOutputTokens: 1300,
  });
  expect(observer.reported).toHaveBeenCalledWith({
    inputTokens: 12,
    outputTokens: null,
  });
  expect(JSON.stringify(observer.reported.mock.calls)).not.toMatch(
    /PRIVATE_|prompt_tokens|api_key/,
  );
});

it("does not activate spending without the rollback contract and never falls back to legacy mode for a partial opt-in", async () => {
  const previous = {
    ready: process.env.FAMILY_AI_USAGE_READY,
    rollback: process.env.FAMILY_AI_USAGE_ROLLBACK_READY,
  };
  try {
    process.env.FAMILY_AI_USAGE_READY = "1";
    delete process.env.FAMILY_AI_USAGE_ROLLBACK_READY;
    expect(isAiUsageAdopted()).toBe(true);
    expect(isAiUsageReady()).toBe(false);
    const db = { $transaction: jest.fn() };
    await expect(
      reserveAiUsage(
        db as never,
        { userId: "person-a", familyId: "family-a", generation: 0 },
        config,
        "assistant",
        { inputBytes: 100, maxOutputTokens: 1300 },
      ),
    ).rejects.toMatchObject({ code: "AI_PAUSED" });
    expect(db.$transaction).not.toHaveBeenCalled();
  } finally {
    if (previous.ready === undefined) delete process.env.FAMILY_AI_USAGE_READY;
    else process.env.FAMILY_AI_USAGE_READY = previous.ready;
    if (previous.rollback === undefined)
      delete process.env.FAMILY_AI_USAGE_ROLLBACK_READY;
    else process.env.FAMILY_AI_USAGE_ROLLBACK_READY = previous.rollback;
  }
});

it("requires a scoped usage observer for every adopted provider path", async () => {
  const previous = {
    ready: process.env.FAMILY_AI_USAGE_READY,
    rollback: process.env.FAMILY_AI_USAGE_ROLLBACK_READY,
  };
  try {
    process.env.FAMILY_AI_USAGE_READY = "1";
    process.env.FAMILY_AI_USAGE_ROLLBACK_READY = "1";
    global.fetch = jest.fn() as never;
    await expect(
      structuredAssistantReply(chat, config, "policy"),
    ).rejects.toThrow("AI usage needs a compatible request");
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {
    if (previous.ready === undefined) delete process.env.FAMILY_AI_USAGE_READY;
    else process.env.FAMILY_AI_USAGE_READY = previous.ready;
    if (previous.rollback === undefined)
      delete process.env.FAMILY_AI_USAGE_ROLLBACK_READY;
    else process.env.FAMILY_AI_USAGE_ROLLBACK_READY = previous.rollback;
  }
});
