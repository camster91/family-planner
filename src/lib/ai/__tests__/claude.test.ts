// Claude provider (#144): request shape through the official SDK, fixed host,
// no retries, bounded response size, refusal/truncation handling and
// content-free errors. No network: fetch is always a mock.
import {
  boundedProviderFetch,
  createClaudeProvider,
  CLAUDE_BASE_URL,
} from "../claude";
import { AiProviderError, type AiStructuredRequest } from "../provider";

const request: AiStructuredRequest = {
  model: "claude-haiku-5-5",
  system: "system prompt",
  user: "Dentist for Person A Tue 3:30",
  maxOutputTokens: 1024,
  schema: { type: "object" },
  timeoutMs: 5_000,
  maxResponseBytes: 4_096,
};

function message(content: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [{ type: "text", text: JSON.stringify(content) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 120,
      output_tokens: 40,
      cache_read_input_tokens: 10,
    },
    ...extra,
  };
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createClaudeProvider", () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  const error = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  afterEach(() => {
    warn.mockClear();
    log.mockClear();
    error.mockClear();
  });

  it("sends one structured-output request to the fixed host and returns JSON plus usage", async () => {
    const fetchMock = jest.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        reply(message({ status: "ok", items: [] })),
    );
    const provider = createClaudeProvider({
      apiKey: "sk-test-not-real",
      fetch: fetchMock,
    });
    const result = await provider.generateStructured(request);
    expect(result).toEqual({
      kind: "json",
      value: { status: "ok", items: [] },
      usage: { inputTokens: 130, outputTokens: 40 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(`${CLAUDE_BASE_URL}/v1/messages`);
    expect(init?.redirect).toBe("manual");
    const headers = new Headers(init?.headers as HeadersInit);
    // SDK 1.x sends the key as a bearer credential.
    expect(headers.get("authorization")).toBe("Bearer sk-test-not-real");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "claude-haiku-5-5",
      max_tokens: 1024,
      system: "system prompt",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: { type: "object" } },
      },
      messages: [{ role: "user", content: "Dentist for Person A Tue 3:30" }],
    });
    // Nothing about the request or reply was logged.
    for (const spy of [warn, log, error])
      expect(JSON.stringify(spy.mock.calls)).not.toContain("Person A");
  });

  it("does not retry and reports only the upstream status for provider errors", async () => {
    const fetchMock = jest.fn(async () =>
      reply({ error: { message: "echo: Dentist for Person A" } }, 529),
    );
    const provider = createClaudeProvider({ apiKey: "k", fetch: fetchMock });
    const failure = await provider.generateStructured(request).catch((e) => e);
    expect(failure).toBeInstanceOf(AiProviderError);
    expect(failure).toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      upstreamStatus: 529,
    });
    expect(String(failure.message)).not.toContain("Person A");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a refusal as content-free and a truncated or non-JSON answer as bad output", async () => {
    const refused = createClaudeProvider({
      apiKey: "k",
      fetch: async () =>
        reply(message({}, { stop_reason: "refusal", content: [] })),
    });
    await expect(refused.generateStructured(request)).resolves.toMatchObject({
      kind: "refused",
    });
    const truncated = createClaudeProvider({
      apiKey: "k",
      fetch: async () =>
        reply(message({ status: "ok" }, { stop_reason: "max_tokens" })),
    });
    await expect(truncated.generateStructured(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_BAD_OUTPUT",
    });
    const prose = createClaudeProvider({
      apiKey: "k",
      fetch: async () =>
        reply(
          message(null, {
            content: [{ type: "text", text: "Sure! Here you go" }],
          }),
        ),
    });
    await expect(prose.generateStructured(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_BAD_OUTPUT",
    });
  });

  it("refuses an oversized success body without reading it all", async () => {
    const big = message({ status: "ok", items: [], pad: "x".repeat(10_000) });
    const provider = createClaudeProvider({
      apiKey: "k",
      fetch: async () => reply(big),
    });
    await expect(provider.generateStructured(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_BAD_OUTPUT",
    });
  });

  it("maps a network failure and a timeout to unavailable", async () => {
    const offline = createClaudeProvider({
      apiKey: "k",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    await expect(offline.generateStructured(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
    const slow = createClaudeProvider({
      apiKey: "k",
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    });
    await expect(
      slow.generateStructured({ ...request, timeoutMs: 20 }),
    ).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
      reason: "timeout",
    });
  });
});

describe("boundedProviderFetch", () => {
  it("drops provider error bodies unread", async () => {
    const state = { oversized: false };
    const wrapped = boundedProviderFetch(
      async () => reply({ error: "echo secret" }, 400),
      100,
      state,
    );
    const response = await wrapped("https://api.anthropic.com/v1/messages");
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("");
  });

  it("flags a declared or streamed body over the limit", async () => {
    const state = { oversized: false };
    const wrapped = boundedProviderFetch(
      async () => reply({ text: "y".repeat(500) }),
      100,
      state,
    );
    await expect(
      wrapped("https://api.anthropic.com/v1/messages"),
    ).rejects.toThrow();
    expect(state.oversized).toBe(true);
  });
});
