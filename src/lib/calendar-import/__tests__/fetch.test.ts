// Guarded ICS fetch: SSRF, redirects, size and time limits (#232). fetch is mocked.

import {
  FeedFetchError,
  checkFeedUrlShape,
  feedUrlHint,
  fetchFeed,
  normalizeFeedUrl,
} from "../fetch";

const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
const allowAll = async () => undefined;

function response(
  status: number,
  body: BodyInit | null = null,
  headers: Record<string, string> = {},
) {
  return new Response(body, { status, headers });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(FeedFetchError);
    return (err as FeedFetchError).code;
  }
  throw new Error("expected rejection");
}

describe("feed URL handling", () => {
  it("rewrites webcal:// and webcals:// to https://", () => {
    expect(normalizeFeedUrl("webcal://calendar.example.com/a.ics")).toBe(
      "https://calendar.example.com/a.ics",
    );
    expect(normalizeFeedUrl("WEBCALS://calendar.example.com/a.ics")).toBe(
      "https://calendar.example.com/a.ics",
    );
    expect(normalizeFeedUrl("https://calendar.example.com/a.ics#x")).toBe(
      "https://calendar.example.com/a.ics",
    );
  });

  it.each([
    ["http://calendar.example.com/a.ics", "https://"],
    ["https://127.0.0.1/a.ics", "public"],
    ["https://169.254.169.254/latest/meta-data", "public"],
    ["https://10.0.0.5/a.ics", "public"],
    ["https://localhost/a.ics", "public"],
    ["https://printer.local/a.ics", "public"],
    ["https://[::1]/a.ics", "public"],
    ["https://user:pass@calendar.example.com/a.ics", "username"],
    ["ftp://calendar.example.com/a.ics", "https://"],
    ["not a url", "not valid"],
  ])("rejects %s", (url, fragment) => {
    expect(checkFeedUrlShape(url)).toContain(fragment);
  });

  it("accepts public https and webcal links", () => {
    expect(
      checkFeedUrlShape(
        "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics",
      ),
    ).toBeNull();
    expect(
      checkFeedUrlShape("webcal://p01-caldav.icloud.com/published/2/abc"),
    ).toBeNull();
  });

  it("hints only the host, never the secret path", () => {
    const hint = feedUrlHint(
      "https://calendar.google.com/calendar/ical/x/private-SECRET/basic.ics",
    );
    expect(hint).toBe("calendar.google.com/…");
    expect(hint).not.toContain("SECRET");
  });
});

describe("fetchFeed", () => {
  it("sends conditional headers, uses manual redirects, and returns validators", async () => {
    const fetchImpl = jest.fn(async () =>
      response(200, ICS, {
        etag: '"v2"',
        "last-modified": "Tue, 01 Sep 2026 00:00:00 GMT",
      }),
    );
    const result = await fetchFeed("webcal://cal.example.com/a.ics", {
      etag: '"v1"',
      lastModified: "Mon, 31 Aug 2026 00:00:00 GMT",
      fetchImpl,
      assertUrl: allowAll,
    });
    expect(result).toEqual({
      notModified: false,
      body: ICS,
      etag: '"v2"',
      lastModified: "Tue, 01 Sep 2026 00:00:00 GMT",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://cal.example.com/a.ics");
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe(
      '"v1"',
    );
    expect((init.headers as Record<string, string>)["If-Modified-Since"]).toBe(
      "Mon, 31 Aug 2026 00:00:00 GMT",
    );
  });

  it("reports 304 Not Modified", async () => {
    const result = await fetchFeed("https://cal.example.com/a.ics", {
      etag: '"v1"',
      fetchImpl: async () => response(304),
      assertUrl: allowAll,
    });
    expect(result).toEqual({ notModified: true });
  });

  it("refuses a private/metadata URL before any request is made (real guard)", async () => {
    const fetchImpl = jest.fn();
    expect(
      await codeOf(
        fetchFeed("https://169.254.169.254/latest/meta-data", { fetchImpl }),
      ),
    ).toBe("url_not_allowed");
    expect(
      await codeOf(fetchFeed("http://cal.example.com/a.ics", { fetchImpl })),
    ).toBe("url_not_allowed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("re-validates every redirect hop and blocks a redirect to a private address", async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url === "https://cal.example.com/a.ics"
        ? response(302, null, { location: "https://127.0.0.1/admin" })
        : response(200, ICS),
    );
    // Real guard for IP literals; public hostnames are allowed without DNS in this test.
    const { assertPublicProviderUrl } =
      jest.requireActual("@/lib/outbound-url");
    const assertUrl = async (url: string) => {
      if (new URL(url).hostname === "cal.example.com") return;
      await assertPublicProviderUrl(url);
    };
    expect(
      await codeOf(
        fetchFeed("https://cal.example.com/a.ics", { fetchImpl, assertUrl }),
      ),
    ).toBe("url_not_allowed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks a redirect that downgrades to http", async () => {
    const fetchImpl = jest.fn(async () =>
      response(301, null, { location: "http://cal.example.com/a.ics" }),
    );
    const { checkProviderUrlShape } = jest.requireActual("@/lib/outbound-url");
    const assertUrl = async (url: string) => {
      const err = checkProviderUrlShape(url);
      if (err) throw new Error(err);
    };
    expect(
      await codeOf(
        fetchFeed("https://cal.example.com/a.ics", { fetchImpl, assertUrl }),
      ),
    ).toBe("url_not_allowed");
  });

  it("follows a few relative redirects, then gives up", async () => {
    let n = 0;
    const ok = jest.fn(async () =>
      ++n <= 2
        ? response(302, null, { location: `/hop${n}.ics` })
        : response(200, ICS),
    );
    const result = await fetchFeed("https://cal.example.com/a.ics", {
      fetchImpl: ok,
      assertUrl: allowAll,
    });
    expect(result.notModified).toBe(false);
    expect(ok.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual([
      "https://cal.example.com/a.ics",
      "https://cal.example.com/hop1.ics",
      "https://cal.example.com/hop2.ics",
    ]);

    const loop = jest.fn(async () =>
      response(302, null, { location: "/again.ics" }),
    );
    expect(
      await codeOf(
        fetchFeed("https://cal.example.com/a.ics", {
          fetchImpl: loop,
          assertUrl: allowAll,
        }),
      ),
    ).toBe("too_many_redirects");
    expect(loop).toHaveBeenCalledTimes(4);
  });

  it("rejects a body over the size limit by Content-Length and while streaming", async () => {
    const declared = async () =>
      response(200, "x", { "content-length": String(3 * 1024 * 1024) });
    expect(
      await codeOf(
        fetchFeed("https://cal.example.com/a.ics", {
          fetchImpl: declared,
          assertUrl: allowAll,
        }),
      ),
    ).toBe("too_large");

    const big = "x".repeat(1024);
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 64; i++)
          controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const streamed = async () => new Response(stream, { status: 200 });
    expect(
      await codeOf(
        fetchFeed("https://cal.example.com/a.ics", {
          fetchImpl: streamed,
          assertUrl: allowAll,
          maxBytes: 16 * 1024,
        }),
      ),
    ).toBe("too_large");
  });

  it("times out a slow feed", async () => {
    const slow = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    expect(
      await codeOf(
        fetchFeed("https://cal.example.com/a.ics", {
          fetchImpl: slow,
          assertUrl: allowAll,
          timeoutMs: 20,
        }),
      ),
    ).toBe("timeout");
  });

  it("maps HTTP and network errors to short messages without the URL", async () => {
    let caught: FeedFetchError | undefined;
    try {
      await fetchFeed("https://cal.example.com/private-SECRET/a.ics", {
        fetchImpl: async () => response(404, "secret body"),
        assertUrl: allowAll,
      });
    } catch (err) {
      caught = err as FeedFetchError;
    }
    expect(caught?.code).toBe("http_error");
    expect(caught?.message).toBe("Feed could not be downloaded (HTTP 404)");
    expect(caught?.message).not.toContain("SECRET");

    const down = async () => {
      throw new Error("getaddrinfo ENOTFOUND cal.example.com");
    };
    expect(
      await codeOf(
        fetchFeed("https://cal.example.com/a.ics", {
          fetchImpl: down,
          assertUrl: allowAll,
        }),
      ),
    ).toBe("network");
  });
});
