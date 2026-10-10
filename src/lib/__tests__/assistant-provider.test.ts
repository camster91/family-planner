import { structuredAssistantReply } from "../capture";
const config = {
  apiKey: "fabricated-test-key",
  model: "test",
  baseUrl: "https://example.test",
  userSuppliedUrl: false,
};
it("sends bounded structured context through the shared provider transport", async () => {
  const context = {
    messages: [{ role: "user", content: "Add milk" }],
    localNow: "now",
    timeZone: "UTC",
  };
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({ reply: "Review", action: null }),
          },
        },
      ],
    }),
  })) as unknown as typeof fetch;
  expect(
    await structuredAssistantReply(context, config, "Typed proposals"),
  ).toEqual({ reply: "Review", action: null });
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe("https://example.test/chat/completions");
  expect(options.redirect).toBe("manual");
  expect(JSON.parse(options.body).max_tokens).toBe(1300);
});
it("cancels oversized provider responses before parsing", async () => {
  const reader = {
    read: jest.fn(async () => ({ done: false, value: new Uint8Array(66000) })),
    cancel: jest.fn(async () => {}),
    releaseLock: jest.fn(),
  };
  global.fetch = jest.fn(async () => ({
    ok: true,
    body: { getReader: () => reader },
  })) as unknown as typeof fetch;
  await expect(
    structuredAssistantReply(
      {
        messages: [{ role: "user", content: "Hello" }],
        localNow: "now",
        timeZone: "UTC",
      },
      config,
      "Typed proposals",
    ),
  ).rejects.toThrow();
  expect(reader.cancel).toHaveBeenCalled();
});
