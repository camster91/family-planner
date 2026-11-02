import {
  readCurrentAndroidBinding,
  type NativeCallBinding,
} from "../native-binding";
import { dispatchRegisteredAndroidWake } from "../android-wake-dispatch";
jest.mock("../native-binding", () => ({
  ...jest.requireActual("../native-binding"),
  readCurrentAndroidBinding: jest.fn(async () => ({
    push_token_enc: "fixture",
    label: "Fixture phone",
  })),
}));
jest.mock("../android-wake-dispatch", () => ({
  dispatchRegisteredAndroidWake: jest.fn(),
}));
import { FamilyCallRoomCore, type CallSocket } from "../room";
import { signCallGrant, callCookieHash, type CallGrant } from "../grant";
import { callActorAllowed } from "../authority";
jest.mock("../authority", () => ({
  callActorAllowed: jest.fn(async () => true),
}));
const secret = "fabricated-calling-test-secret-at-least-32-characters",
  origin = "https://herewoven.example.test";
class Socket {
  readyState = 1;
  data: unknown;
  messages: any[] = [];
  closeCode?: number;
  serializeAttachment(value: unknown) {
    this.data = structuredClone(value);
  }
  deserializeAttachment() {
    return structuredClone(this.data);
  }
  send(value: string) {
    this.messages.push(JSON.parse(value));
  }
  close(code: number) {
    this.closeCode = code;
    this.readyState = 3;
  }
}
let sockets: Socket[], room: FamilyCallRoomCore, env: any;
const NativeResponse = Response;
beforeEach(() => {
  jest.mocked(callActorAllowed).mockResolvedValue(true);
  jest
    .mocked(readCurrentAndroidBinding)
    .mockResolvedValue({ push_token_enc: "fixture", label: "Fixture phone" });
  jest.mocked(dispatchRegisteredAndroidWake).mockReset();
  sockets = [];
  (globalThis as any).WebSocketPair = class {
    0 = new Socket();
    1 = new Socket();
  };
  globalThis.Response = function (body: unknown, init: any) {
    if (init?.status === 101) {
      const response = new NativeResponse(null);
      Object.defineProperty(response, "status", { value: 101 });
      return response;
    }
    return new NativeResponse(body as any, init);
  } as any;
  env = {
    CALLING_ENABLED: "1",
    SHARED_DEVICE_ENABLED: "1",
    JWT_SECRET: secret,
    NEXT_PUBLIC_APP_URL: origin,
    DB: {},
  };
  room = new FamilyCallRoomCore(
    {
      acceptWebSocket: (s) => sockets.push(s as unknown as Socket),
      getWebSockets: () => sockets as unknown as CallSocket[],
    },
    env,
  );
});
afterEach(() => {
  globalThis.Response = NativeResponse;
  jest.restoreAllMocks();
});
async function join(user: string, familyId = "family-a") {
  const cookie = "cookie-" + user,
    now = Date.now();
  const grant: CallGrant = {
    kind: "person",
    userId: user,
    generation: 0,
    familyId,
    label: user,
    endpointId: crypto.randomUUID(),
    origin,
    cookieHash: callCookieHash(cookie),
    issuedAt: now,
    expiresAt: now + 60000,
    purpose: "family-call-v1",
  };
  const response = await room.fetch(
    new Request(origin + "/api/calls/socket", {
      headers: {
        Origin: origin,
        Cookie: "session_token=" + cookie,
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol":
          "herewoven.calls.v1, " + signCallGrant(grant, secret),
      },
    }),
  );
  return {
    status: response.status,
    socket: sockets[sockets.length - 1],
    id: grant.endpointId,
  };
}
const send = (s: Socket, m: unknown) =>
  room.webSocketMessage(s as unknown as CallSocket, JSON.stringify(m));
const last = (s: Socket, type: string) =>
  [...s.messages].reverse().find((m) => m.type === type);
it("admits only the room household and never exposes a foreign endpoint", async () => {
  const a = await join("a");
  expect(a.status).toBe(101);
  expect((await join("foreign", "family-b")).status).toBe(409);
  expect(sockets).toHaveLength(1);
  expect(last(a.socket, "presence").endpoints).toEqual([]);
});
it("coordinates ringing, duplicate/busy attempts, membership and close cleanup", async () => {
  const a = await join("a"),
    b = await join("b"),
    c = await join("c");
  await send(a.socket, { type: "call", target: b.id, mode: "voice" });
  const id = last(b.socket, "ringing").callId;
  expect(last(b.socket, "ringing").incoming).toBe(true);
  await send(c.socket, { type: "call", target: b.id, mode: "voice" });
  expect(last(c.socket, "error").code).toBe("busy");
  await send(b.socket, { type: "accept", callId: id, mode: "video" });
  expect(last(b.socket, "error").code).toBe("invalid");
  await send(b.socket, { type: "accept", callId: id, mode: "voice" });
  expect(last(a.socket, "accepted").initiator).toBe(true);
  const signal = {
    type: "offer",
    sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
  };
  await send(c.socket, { type: "signal", callId: id, signal });
  expect(last(b.socket, "signal")).toBeUndefined();
  await send(a.socket, { type: "signal", callId: id, signal });
  expect(last(b.socket, "signal").signal).toEqual(signal);
  await room.webSocketClose(b.socket as unknown as CallSocket);
  expect(last(a.socket, "ended").reason).toBe("unavailable");
});
it("downgrades video to voice before accepting SDP and preserves state across hibernation", async () => {
  const a = await join("a"),
    b = await join("b");
  await send(a.socket, { type: "call", target: b.id, mode: "video" });
  const id = last(b.socket, "ringing").callId;
  room = new FamilyCallRoomCore(
    {
      acceptWebSocket: () => undefined,
      getWebSockets: () => sockets as unknown as CallSocket[],
    },
    env,
  );
  await send(b.socket, { type: "accept", callId: id, mode: "voice" });
  expect(last(a.socket, "accepted").mode).toBe("voice");
  await send(a.socket, {
    type: "signal",
    callId: id,
    signal: { type: "offer", sdp: "v=0\r\nm=video 9 RTP/SAVPF 96\r\n" },
  });
  expect(last(a.socket, "error").code).toBe("invalid");
  expect(last(b.socket, "signal")).toBeUndefined();
  await send(a.socket, { type: "end", callId: id });
  expect(last(b.socket, "ended").callId).toBe(id);
});
it("does not resurrect an expired call or admit a revoked peer", async () => {
  const a = await join("a"),
    b = await join("b");
  await send(a.socket, { type: "call", target: b.id, mode: "voice" });
  const id = last(b.socket, "ringing").callId;
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now + 31000);
  await send(b.socket, { type: "accept", callId: id, mode: "voice" });
  expect(last(a.socket, "ended").reason).toBe("timeout");
  expect((b.socket.data as any).call).toBeUndefined();
  jest
    .mocked(callActorAllowed)
    .mockImplementation(
      async (_db, actor) => actor.kind === "person" && actor.userId !== "b",
    );
  await send(b.socket, { type: "heartbeat" });
  expect(b.socket.closeCode).toBe(4003);
});
it("refuses DND recipients and oversize messages", async () => {
  const a = await join("a"),
    b = await join("b");
  await send(b.socket, { type: "availability", dnd: true });
  await send(a.socket, { type: "call", target: b.id, mode: "video" });
  expect(last(a.socket, "error").code).toBe("busy");
  await room.webSocketMessage(
    a.socket as unknown as CallSocket,
    "x".repeat(32769),
  );
  expect(a.socket.closeCode).toBe(1009);
});

const nativeTarget = (): NativeCallBinding => ({
  installationId: "11111111-1111-4111-8111-111111111111",
  epoch: "22222222-2222-4222-8222-222222222222",
  revision: 1,
  owner: { userId: "b", familyId: "family-a", generation: 0 },
});
const asSocket = (socket: Socket) => socket as unknown as CallSocket;
const enableNative = () => {
  env.CALLING_NATIVE_REGISTRATION_ENABLED = "1";
  env.CALLING_NATIVE_COORDINATION_ENABLED = "1";
};
it("does not expose sleeping calling with the default-off native coordinator", async () => {
  const a = await join("a");
  expect(
    await room.beginSleepingCall(asSocket(a.socket), nativeTarget(), "voice"),
  ).toBeNull();
  expect((a.socket.data as any).call).toBeUndefined();
});
it("reserves one wake per sleeping call, keeps the phone busy, and preserves reservations across room reconstruction", async () => {
  enableNative();
  const a = await join("a"),
    c = await join("c");
  const hint = await room.beginSleepingCall(
    asSocket(a.socket),
    nativeTarget(),
    "video",
  );
  expect(hint?.expiresAt).toBeGreaterThan(Date.now());
  expect(
    await room.beginSleepingCall(asSocket(c.socket), nativeTarget(), "voice"),
  ).toBeNull();
  expect(await room.reserveSleepingWake(asSocket(a.socket), hint!.callId)).toBe(
    true,
  );
  room = new FamilyCallRoomCore(
    {
      acceptWebSocket: () => undefined,
      getWebSockets: () => sockets as unknown as CallSocket[],
    },
    env,
  );
  expect(await room.reserveSleepingWake(asSocket(a.socket), hint!.callId)).toBe(
    false,
  );
  expect(await room.sleepingCallCurrent(asSocket(a.socket), hint!.callId)).toBe(
    true,
  );
});
it("commits exactly one concurrent answer and preserves voice downgrade and normal signaling cleanup", async () => {
  enableNative();
  const a = await join("a"),
    b = await join("b"),
    other = await join("b");
  const hint = (await room.beginSleepingCall(
    asSocket(a.socket),
    nativeTarget(),
    "video",
  ))!;
  const accepted = await Promise.all(
    [b, other].map((peer) =>
      room.claimSleepingCall(
        asSocket(peer.socket),
        hint.callId,
        nativeTarget(),
        "voice",
        async () => true,
      ),
    ),
  );
  expect(accepted.filter(Boolean)).toHaveLength(1);
  const receiver = accepted[0] ? b : other;
  expect(last(a.socket, "accepted").mode).toBe("voice");
  await send(a.socket, {
    type: "signal",
    callId: hint.callId,
    signal: { type: "offer", sdp: "v=0\r\nm=video 9 RTP/SAVPF 96\r\n" },
  });
  expect(last(a.socket, "error").code).toBe("invalid");
  await send(receiver.socket, { type: "end", callId: hint.callId });
  expect((a.socket.data as any).call).toBeUndefined();
  expect(
    await room.claimSleepingCall(
      asSocket(other.socket),
      hint.callId,
      nativeTarget(),
      "voice",
      async () => true,
    ),
  ).toBe(false);
});
it("rejects account-only ownership, wrong devices, foreign callers and expired answers", async () => {
  enableNative();
  const a = await join("a"),
    b = await join("b");
  // A cross-household connection cannot coexist in the real room; explicitly use
  // an owner mismatch on the caller already in the room for this negative case.
  expect(
    await room.beginSleepingCall(
      asSocket(a.socket),
      {
        ...nativeTarget(),
        owner: { ...nativeTarget().owner, familyId: "other" },
      },
      "voice",
    ),
  ).toBeNull();
  const hint = (await room.beginSleepingCall(
    asSocket(a.socket),
    nativeTarget(),
    "voice",
  ))!;
  expect(
    await room.claimSleepingCall(
      asSocket(b.socket),
      hint.callId,
      nativeTarget(),
      "voice",
      async () => false,
    ),
  ).toBe(false);
  expect(
    await room.claimSleepingCall(
      asSocket(b.socket),
      hint.callId,
      { ...nativeTarget(), revision: 2 },
      "voice",
      async () => true,
    ),
  ).toBe(false);
  expect(
    await room.claimSleepingCall(
      asSocket(b.socket),
      hint.callId,
      nativeTarget(),
      "video",
      async () => true,
    ),
  ).toBe(false);
  jest.spyOn(Date, "now").mockReturnValue(hint.expiresAt);
  expect(
    await room.claimSleepingCall(
      asSocket(b.socket),
      hint.callId,
      nativeTarget(),
      "voice",
      async () => true,
    ),
  ).toBe(false);
  expect(last(a.socket, "ended").reason).toBe("timeout");
});
it("does not block cancellation while native ownership verification waits", async () => {
  enableNative();
  const a = await join("a"),
    b = await join("b");
  const hint = (await room.beginSleepingCall(
    asSocket(a.socket),
    nativeTarget(),
    "voice",
  ))!;
  let release!: (value: boolean) => void;
  const answer = room.claimSleepingCall(
    asSocket(b.socket),
    hint.callId,
    nativeTarget(),
    "voice",
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await send(a.socket, { type: "end", callId: hint.callId });
  release(true);
  expect(await answer).toBe(false);
});
it("keeps End responsive during wake I/O and never dispatches the same call twice", async () => {
  enableNative();
  const a = await join("a");
  const hint = (await room.beginSleepingCall(
    asSocket(a.socket),
    nativeTarget(),
    "voice",
  ))!;
  let release!: () => void, started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  jest
    .mocked(dispatchRegisteredAndroidWake)
    .mockImplementation(async (_db, _config, _input, current) => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { status: (await current()) ? "accepted" : "cancelled" };
    });
  const pending = room.dispatchSleepingWake(asSocket(a.socket), hint.callId, {
    enabled: true,
  });
  await began;
  expect(
    await room.dispatchSleepingWake(asSocket(a.socket), hint.callId, {
      enabled: true,
    }),
  ).toEqual({ status: "cancelled" });
  await send(a.socket, { type: "end", callId: hint.callId });
  release();
  expect(await pending).toEqual({ status: "cancelled" });
  expect(dispatchRegisteredAndroidWake).toHaveBeenCalledTimes(1);
});
it("revokes both active peers when the native installation is unlinked", async () => {
  enableNative();
  const a = await join("a"),
    b = await join("b");
  const hint = (await room.beginSleepingCall(
    asSocket(a.socket),
    nativeTarget(),
    "voice",
  ))!;
  expect(
    await room.claimSleepingCall(
      asSocket(b.socket),
      hint.callId,
      nativeTarget(),
      "voice",
      async () => true,
    ),
  ).toBe(true);
  jest.mocked(readCurrentAndroidBinding).mockResolvedValue(null);
  await send(b.socket, { type: "heartbeat" });
  expect(last(a.socket, "ended").reason).toBe("unavailable");
  expect((a.socket.data as any).call).toBeUndefined();
  expect((b.socket.data as any).call).toBeUndefined();
});

it.each(["unknown", "unavailable"] as const)(
  "handles %s delivery without releasing the wake reservation",
  async (status) => {
    enableNative();
    const a = await join("a");
    const hint = (await room.beginSleepingCall(
      asSocket(a.socket),
      nativeTarget(),
      "voice",
    ))!;
    jest.mocked(dispatchRegisteredAndroidWake).mockResolvedValue({ status });
    expect(
      await room.dispatchSleepingWake(asSocket(a.socket), hint.callId, {
        enabled: true,
      }),
    ).toEqual({ status });
    expect(
      await room.dispatchSleepingWake(asSocket(a.socket), hint.callId, {
        enabled: true,
      }),
    ).toEqual({ status: "cancelled" });
    expect(dispatchRegisteredAndroidWake).toHaveBeenCalledTimes(1);
    if (status === "unknown") {
      expect(
        await room.sleepingCallCurrent(asSocket(a.socket), hint.callId),
      ).toBe(true);
    } else {
      expect((a.socket.data as any).call).toBeUndefined();
      expect(last(a.socket, "ended").reason).toBe("unavailable");
    }
  },
);
