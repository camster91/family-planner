import { generateKeyPairSync, verify } from "node:crypto";
import { sendAndroidCallWake, type AndroidWakeHint } from "../android-wake";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const account = {
  type: "service_account",
  project_id: "herewoven-fixture",
  private_key_id: "a".repeat(40),
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  client_email: "fixture@herewoven-fixture.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token",
};
const config = {
  enabled: true,
  projectId: account.project_id,
  serviceAccountJson: JSON.stringify(account),
};
const time = 1_800_000_000_000;
const hint: AndroidWakeHint = {
  protocol: "herewoven.call-wake.v1",
  callId: "11111111-1111-4111-8111-111111111111",
  installationId: "22222222-2222-4222-8222-222222222222",
  epoch: "33333333-3333-4333-8333-333333333333",
  revision: 2,
  expiresAt: time + 30_000,
};
const destination = "fabricated-routing-destination";
const oauth = () =>
  Response.json({
    access_token: "fixture-access-token",
    token_type: "Bearer",
    expires_in: 3600,
  });
const accepted = () =>
  Response.json({ name: "projects/herewoven-fixture/messages/fixture" });
const current = () => Promise.resolve(true);

it("signs scoped OAuth, sends only neutral strings to the pinned FCM project and never queues late rings", async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = jest.fn(async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return requests.length === 1 ? oauth() : accepted();
  }) as jest.MockedFunction<typeof fetch>;
  expect(
    await sendAndroidCallWake(config, destination, hint, current, {
      fetchImpl,
      now: () => time,
    }),
  ).toEqual({ status: "accepted" });
  const assertion = new URLSearchParams(
    requests[0].init.body as URLSearchParams,
  ).get("assertion")!;
  const [header, claims, signature] = assertion.split(".");
  expect(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${claims}`),
      publicKey,
      Buffer.from(signature, "base64url"),
    ),
  ).toBe(true);
  expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: time / 1000,
    exp: time / 1000 + 300,
  });
  expect(requests.map((r) => r.url)).toEqual([
    "https://oauth2.googleapis.com/token",
    "https://fcm.googleapis.com/v1/projects/herewoven-fixture/messages:send",
  ]);
  expect(requests.every((r) => r.init.redirect === "error")).toBe(true);
  const message = JSON.parse(requests[1].init.body as string).message;
  expect(message).toEqual({
    token: destination,
    android: {
      priority: "HIGH",
      ttl: "0s",
      restricted_package_name: "com.ashbi.familyplanner",
    },
    data: { ...hint, revision: "2", expiresAt: String(hint.expiresAt) },
  });
  expect(message).not.toHaveProperty("notification");
});

it.each([
  [{ ...config, enabled: false }, hint, "unavailable"],
  [config, { ...hint, expiresAt: time }, "expired"],
  [config, { ...hint, expiresAt: time + 30_001 }, "expired"],
  [config, { ...hint, callerName: "Private family detail" }, "rejected"],
  [{ ...config, projectId: "../attacker" }, hint, "unavailable"],
  [{ ...config, projectId: "another-project" }, hint, "unavailable"],
  [
    {
      ...config,
      serviceAccountJson: JSON.stringify({
        ...account,
        token_uri: "https://attacker.test/token",
      }),
    },
    hint,
    "unavailable",
  ],
])(
  "refuses disabled, stale, invalid, private or untrusted-provider input without network",
  async (cfg, input, status) => {
    const fetchImpl = jest.fn();
    const result = await sendAndroidCallWake(
      cfg,
      destination,
      input as AndroidWakeHint,
      current,
      { fetchImpl, now: () => time },
    );
    expect(result).toEqual({ status });
    expect(fetchImpl).not.toHaveBeenCalled();
  },
);

it("rechecks cancellation after OAuth before sending anything to the destination", async () => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(oauth());
  const stillCurrent = jest
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  expect(
    await sendAndroidCallWake(config, destination, hint, stillCurrent, {
      fetchImpl,
      now: () => time,
    }),
  ).toEqual({ status: "cancelled" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("refuses a call that expired during OAuth", async () => {
  let clock = time;
  const fetchImpl = jest.fn(async () => {
    clock = hint.expiresAt;
    return oauth();
  });
  expect(
    await sendAndroidCallWake(config, destination, hint, current, {
      fetchImpl,
      now: () => clock,
    }),
  ).toEqual({ status: "expired" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it.each([
  [
    404,
    {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: "UNREGISTERED",
          },
        ],
      },
    },
    "invalid-destination",
  ],
  [
    400,
    {
      error: {
        details: [
          {
            "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError",
            errorCode: "INVALID_ARGUMENT",
          },
        ],
      },
    },
    "rejected",
  ],
  [
    404,
    {
      error: {
        details: [{ "@type": "untrusted.error", errorCode: "UNREGISTERED" }],
      },
    },
    "rejected",
  ],
  [401, { private: "provider-secret" }, "unavailable"],
  [403, {}, "unavailable"],
  [429, {}, "unavailable"],
  [503, {}, "unknown"],
  [200, {}, "unknown"],
])(
  "classifies provider status %s without exposing bodies, retrying or claiming delivery",
  async (status, body, expected) => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(oauth())
      .mockResolvedValueOnce(Response.json(body, { status }));
    expect(
      await sendAndroidCallWake(config, destination, hint, current, {
        fetchImpl,
        now: () => time,
      }),
    ).toEqual({ status: expected });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  },
);

it("does not retry an ambiguous dispatch and never leaks the exception", async () => {
  const fetchImpl = jest
    .fn()
    .mockResolvedValueOnce(oauth())
    .mockRejectedValueOnce(new Error("provider-private-token"));
  expect(
    await sendAndroidCallWake(config, destination, hint, current, {
      fetchImpl,
      now: () => time,
    }),
  ).toEqual({ status: "unknown" });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("bounds OAuth response bodies before sending", async () => {
  const fetchImpl = jest
    .fn()
    .mockResolvedValueOnce(
      new Response("x", { headers: { "content-length": "20000" } }),
    );
  expect(
    await sendAndroidCallWake(config, destination, hint, current, {
      fetchImpl,
      now: () => time,
    }),
  ).toEqual({ status: "unavailable" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("refuses an already-cancelled call before obtaining provider credentials", async () => {
  const fetchImpl = jest.fn();
  expect(
    await sendAndroidCallWake(config, destination, hint, async () => false, {
      fetchImpl,
      now: () => time,
    }),
  ).toEqual({ status: "cancelled" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("bounds the streamed provider acknowledgement and keeps the outcome unknown", async () => {
  const fetchImpl = jest
    .fn()
    .mockResolvedValueOnce(oauth())
    .mockResolvedValueOnce(new Response("x".repeat(8193)));
  expect(
    await sendAndroidCallWake(config, destination, hint, current, {
      fetchImpl,
      now: () => time,
    }),
  ).toEqual({ status: "unknown" });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("settles even when the provider ignores abort and never answers", async () => {
  jest.useFakeTimers();
  try {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(oauth())
      .mockImplementationOnce(() => new Promise(() => undefined));
    const result = sendAndroidCallWake(config, destination, hint, current, {
      fetchImpl,
      now: () => time,
    });
    await jest.advanceTimersByTimeAsync(6_001);
    expect(await result).toEqual({ status: "unknown" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
