/** @jest-environment jsdom */
import { CallingClient, type CallingSession } from "../client";
const peerInfo = {
  id: "79c51cd5-bf70-4972-9af5-69bafad79251",
  label: "Kitchen",
  kind: "device" as const,
  status: "available" as const,
};
const callId = "f2f39d6e-758e-47b6-a379-032fbf8ad870";
const endpointId = "302a187d-49dd-47bc-8488-d026a0e2908e";
class Track {
  enabled = true;
  stop = jest.fn();
  constructor(public kind: string) {}
}
class Stream {
  constructor(public tracks: Track[]) {}
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  addTrack(track: Track) {
    this.tracks.push(track);
  }
  removeTrack(track: Track) {
    this.tracks = this.tracks.filter((t) => t !== track);
  }
}
class Socket {
  static OPEN = 1;
  static last: Socket;
  readyState = 1;
  send = jest.fn();
  close = jest.fn();
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose = null;
  onerror = null;
  constructor() {
    Socket.last = this;
  }
}
class Peer {
  static last: Peer;
  senders: { kind: string; track: Track | null; replaceTrack: jest.Mock }[] =
    [];
  close = jest.fn();
  ontrack = null;
  onicecandidate = null;
  onconnectionstatechange = null;
  constructor(public configuration: RTCConfiguration) {
    Peer.last = this;
  }
  addTrack(track: Track) {
    const sender = {
      kind: track.kind,
      track: track as Track | null,
      replaceTrack: jest.fn(async (next: Track | null) => {
        sender.track = next;
      }),
    };
    this.senders.push(sender);
  }
  getSenders() {
    return this.senders;
  }
  getTransceivers() {
    return this.senders.map((sender) => ({
      receiver: { track: { kind: sender.kind } },
      sender,
    }));
  }
}
let client: CallingClient, capture: jest.Mock;
const oldSocket = global.WebSocket,
  oldPeer = global.RTCPeerConnection;
const oldDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
async function message(body: unknown) {
  Socket.last.onmessage?.({ data: JSON.stringify(body) });
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
async function ready() {
  await client.connect("Phone");
  await message({ type: "ready", endpointId, endpoints: [peerInfo] });
}
async function incoming() {
  await message({
    type: "ringing",
    callId,
    peer: peerInfo,
    incoming: true,
    mode: "video",
  });
}
async function video() {
  const audio = new Track("audio"),
    camera = new Track("video");
  capture.mockResolvedValueOnce(new Stream([audio, camera]));
  await ready();
  await incoming();
  await client.answer("video");
  await message({ type: "accepted", callId, mode: "video", initiator: false });
  return { audio, camera };
}
beforeEach(() => {
  jest.useFakeTimers();
  capture = jest.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: capture },
  });
  global.WebSocket = Socket as unknown as typeof WebSocket;
  global.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
  client = new CallingClient(
    async () =>
      ({
        enabled: true,
        socketPath: "/api/calls/socket",
        grant: "fixture-grant",
        iceServers: [],
      }) satisfies CallingSession,
  );
});
afterEach(() => {
  client.disconnect();
  jest.clearAllTimers();
  jest.useRealTimers();
  global.WebSocket = oldSocket;
  global.RTCPeerConnection = oldPeer;
  if (oldDevices) Object.defineProperty(navigator, "mediaDevices", oldDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});
it("does not activate microphone or camera on enable or incoming ring", async () => {
  await ready();
  await incoming();
  expect(client.getSnapshot().call?.incoming).toBe(true);
  expect(capture).not.toHaveBeenCalled();
});
it("stops a permission result that arrives after the caller cancels", async () => {
  let release!: (stream: Stream) => void;
  capture.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await ready();
  const dialing = client.dial(peerInfo, "video");
  client.end();
  const audio = new Track("audio"),
    camera = new Track("video");
  release(new Stream([audio, camera]));
  await dialing;
  expect(audio.stop).toHaveBeenCalledTimes(1);
  expect(camera.stop).toHaveBeenCalledTimes(1);
  expect(client.getSnapshot().call).toBeNull();
  expect(Socket.last.send).not.toHaveBeenCalled();
});
it("stops the camera immediately even if detaching its sender fails", async () => {
  const { audio, camera } = await video();
  expect(Peer.last.configuration.iceTransportPolicy).toBe("all");
  Peer.last
    .getSenders()
    .find((s) => s.kind === "video")!
    .replaceTrack.mockRejectedValueOnce(Error("fixture detach failure"));
  await client.toggleCamera();
  expect(camera.stop).toHaveBeenCalled();
  expect(audio.stop).toHaveBeenCalled();
  expect(client.getSnapshot().call).toBeNull();
  expect(Peer.last.close).toHaveBeenCalled();
});
it("releases a newly captured camera when reattachment fails, keeping audio usable", async () => {
  const { audio, camera } = await video();
  await client.toggleCamera();
  expect(camera.stop).toHaveBeenCalledTimes(1);
  const replacement = new Track("video");
  capture.mockResolvedValueOnce(new Stream([replacement]));
  Peer.last
    .getSenders()
    .find((s) => s.kind === "video")!
    .replaceTrack.mockRejectedValueOnce(Error("fixture attach failure"));
  await client.toggleCamera();
  expect(replacement.stop).toHaveBeenCalledTimes(1);
  expect(audio.stop).not.toHaveBeenCalled();
  expect(client.getSnapshot().camera).toBe(false);
  client.end();
  expect(audio.stop).toHaveBeenCalledTimes(1);
  expect(Peer.last.close).toHaveBeenCalled();
});
