import { z } from "zod";
import {
  CALL_PROTOCOL,
  HEARTBEAT_MS,
  MAX_CALL_MS,
  RING_MS,
  serverMessageSchema,
  type CallEndpoint,
  type ClientCallMessage,
  type ServerCallMessage,
} from "./protocol";
export type CallMode = "voice" | "video";
export type CallView = {
  id: string | null;
  peer: CallEndpoint;
  incoming: boolean;
  mode: CallMode;
  phase: "preparing" | "ringing" | "connecting" | "active";
};
export type CallingSnapshot = {
  status: "off" | "connecting" | "ready" | "unavailable";
  endpoints: CallEndpoint[];
  call: CallView | null;
  muted: boolean;
  camera: boolean;
  dnd: boolean;
  error: "permission" | "network" | "unavailable" | "busy" | "timeout" | null;
  needsPlay: boolean;
};
export const callingSessionSchema = z.object({
  enabled: z.literal(true),
  socketPath: z.literal("/api/calls/socket"),
  grant: z.string().min(1).max(4096),
  iceServers: z
    .array(
      z.object({
        urls: z.array(z.string()).max(12),
        username: z.string().optional(),
        credential: z.string().optional(),
      }),
    )
    .max(4),
});
export type CallingSession = z.infer<typeof callingSessionSchema>;
export type CallingSessionLoader = (
  label: string,
  signal: AbortSignal,
) => Promise<CallingSession>;
const videoConstraints: MediaTrackConstraints = {
  width: { ideal: 1280, max: 1280 },
  height: { ideal: 720, max: 720 },
  frameRate: { ideal: 20, max: 24 },
  facingMode: "user",
};
/** Browser-only media controller. No streams, credentials or transcripts are persisted. */
export class CallingClient {
  private snapshot: CallingSnapshot = {
    status: "off",
    endpoints: [],
    call: null,
    muted: false,
    camera: false,
    dnd: false,
    error: null,
    needsPlay: false,
  };
  private listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private peer: RTCPeerConnection | null = null;
  private remote: MediaStream | null = null;
  private mediaElement: HTMLMediaElement | null = null;
  private sessionAbort: AbortController | null = null;
  private session: CallingSession | null = null;
  private sessionAt = 0;
  private label = "";
  private epoch = 0;
  private operation = 0;
  private beat: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private loss: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private ice: RTCIceCandidateInit[] = [];
  private lastServer = 0;
  private cameraBusy = false;
  constructor(private loadSession: CallingSessionLoader) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<CallingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private send(message: ClientCallMessage) {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw Error("Calling unavailable");
    this.socket.send(JSON.stringify(message));
  }
  private async sessionData(controller: AbortController) {
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      return callingSessionSchema.parse(
        await this.loadSession(this.label, controller.signal),
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async connect(label: string) {
    this.disconnect();
    this.label = label;
    const epoch = ++this.epoch;
    this.update({ status: "connecting", error: null });
    const abort = new AbortController();
    this.sessionAbort = abort;
    try {
      const session = await this.sessionData(abort);
      if (epoch !== this.epoch || abort.signal.aborted) return;
      this.session = session;
      this.sessionAt = Date.now();
      const url = new URL(session.socketPath, location.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url, [CALL_PROTOCOL, session.grant]);
      this.socket = socket;
      const opening = setTimeout(() => {
        if (this.socket === socket && this.snapshot.status !== "ready")
          this.fail("network");
      }, 12_000);
      socket.onmessage = (event) => {
        if (
          epoch !== this.epoch ||
          typeof event.data !== "string" ||
          event.data.length > 40_000
        )
          return;
        this.queue = this.queue
          .then(async () => {
            if (epoch !== this.epoch) return;
            const message = serverMessageSchema.parse(JSON.parse(event.data));
            this.lastServer = Date.now();
            await this.message(message);
          })
          .catch(() => {
            if (epoch === this.epoch) this.fail("network");
          });
      };
      socket.onclose = () => {
        clearTimeout(opening);
        if (epoch === this.epoch) this.fail("network");
      };
      socket.onerror = () => {
        if (epoch === this.epoch) this.fail("network");
      };
      this.beat = setInterval(() => {
        if (epoch !== this.epoch) return;
        if (
          this.lastServer &&
          Date.now() - this.lastServer > HEARTBEAT_MS * 3
        ) {
          this.fail("network");
          return;
        }
        try {
          this.send({ type: "heartbeat" });
        } catch {
          this.fail("network");
        }
      }, HEARTBEAT_MS);
    } catch {
      if (epoch === this.epoch && !abort.signal.aborted)
        this.fail("unavailable");
      else if (epoch === this.epoch) this.fail("network");
    }
  }
  setMediaElement(element: HTMLMediaElement | null) {
    this.mediaElement = element;
    if (element && this.remote) {
      element.srcObject = this.remote;
      void this.play();
    }
  }
  getLocalStream() {
    return this.stream;
  }
  async play() {
    if (!this.mediaElement) return;
    try {
      await this.mediaElement.play();
      this.update({ needsPlay: false });
    } catch {
      this.update({ needsPlay: true });
    }
  }
  private clearMedia() {
    this.operation++;
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    if (this.loss) clearTimeout(this.loss);
    this.loss = null;
    if (this.peer) {
      this.peer.ontrack = null;
      this.peer.onicecandidate = null;
      this.peer.onconnectionstatechange = null;
      this.peer.close();
      this.peer = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.remote?.getTracks().forEach((track) => track.stop());
    this.remote = null;
    if (this.mediaElement) this.mediaElement.srcObject = null;
    this.ice = [];
  }
  end() {
    const id = this.snapshot.call?.id;
    if (id)
      try {
        this.send({ type: "end", callId: id });
      } catch {
        /* disconnected */
      }
    this.clearMedia();
    this.update({ call: null, muted: false, camera: false, needsPlay: false });
  }
  disconnect() {
    this.end();
    this.epoch++;
    this.sessionAbort?.abort();
    this.sessionAbort = null;
    if (this.beat) clearInterval(this.beat);
    this.beat = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.close();
    }
    this.session = null;
    this.lastServer = 0;
    this.update({ status: "off", endpoints: [], dnd: false });
  }
  private fail(error: CallingSnapshot["error"]) {
    this.disconnect();
    this.update({ status: "unavailable", error });
  }
  private timer(ms: number) {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = setTimeout(() => {
      this.end();
      this.update({ error: "timeout" });
    }, ms);
  }
  private async prepare(mode: CallMode, operation: number) {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: mode === "video" ? videoConstraints : false,
      });
    } catch {
      if (operation === this.operation) {
        this.end();
        this.update({ error: "permission" });
      }
      return false;
    }
    if (operation !== this.operation) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    this.stream = stream;
    this.update({ muted: false, camera: mode === "video" });
    if (Date.now() - this.sessionAt > 25 * 60_000) {
      const abort = new AbortController();
      this.sessionAbort = abort;
      try {
        const session = await this.sessionData(abort);
        if (operation !== this.operation) return false;
        this.session = session;
        this.sessionAt = Date.now();
      } catch {
        if (operation === this.operation) {
          this.end();
          this.update({ error: "network" });
        }
        return false;
      }
    }
    return operation === this.operation;
  }
  async dial(target: CallEndpoint, mode: CallMode) {
    if (
      this.snapshot.status !== "ready" ||
      this.snapshot.call ||
      this.snapshot.dnd ||
      target.status !== "available"
    )
      return;
    this.update({
      call: {
        id: null,
        peer: target,
        incoming: false,
        mode,
        phase: "preparing",
      },
      error: null,
    });
    const operation = ++this.operation;
    this.timer(RING_MS);
    if (!(await this.prepare(mode, operation))) return;
    try {
      this.send({ type: "call", target: target.id, mode });
    } catch {
      this.end();
      this.update({ error: "network" });
    }
  }
  async answer(mode: CallMode) {
    const call = this.snapshot.call;
    if (
      !call?.id ||
      !call.incoming ||
      call.phase !== "ringing" ||
      (mode === "video" && call.mode !== "video")
    )
      return;
    this.update({ call: { ...call, phase: "preparing" }, error: null });
    const operation = ++this.operation;
    if (!(await this.prepare(mode, operation))) return;
    try {
      this.send({ type: "accept", callId: call.id, mode });
    } catch {
      this.end();
      this.update({ error: "network" });
    }
  }
  mute() {
    const muted = !this.snapshot.muted;
    this.stream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
    this.update({ muted });
  }
  async toggleCamera() {
    if (
      this.cameraBusy ||
      this.snapshot.call?.mode !== "video" ||
      !this.peer ||
      !this.stream
    )
      return;
    this.cameraBusy = true;
    try {
      if (this.snapshot.camera) {
        const peer = this.peer,
          stream = this.stream,
          operation = this.operation;
        const sender = peer.getSenders().find((s) => s.track?.kind === "video");
        // Stop capture immediately, even if detaching the sender fails or stalls.
        stream.getVideoTracks().forEach((track) => {
          track.stop();
          stream.removeTrack(track);
        });
        this.update({ camera: false });
        try {
          await sender?.replaceTrack(null);
        } catch {
          if (operation === this.operation && this.peer === peer) {
            this.end();
            this.update({ error: "network" });
          }
        }
        return;
      }
      const operation = this.operation,
        peer = this.peer,
        stream = this.stream;
      let capture: MediaStream | null = null,
        adopted = false;
      try {
        capture = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
        });
        if (
          operation !== this.operation ||
          this.peer !== peer ||
          !this.snapshot.call
        )
          return;
        const track = capture.getVideoTracks()[0],
          sender =
            peer.getSenders().find((s) => s.track?.kind === "video") ||
            peer
              .getTransceivers()
              .find((t) => t.receiver.track.kind === "video")?.sender;
        if (!track || !sender) return;
        await sender.replaceTrack(track);
        if (operation !== this.operation || this.peer !== peer) return;
        stream.addTrack(track);
        adopted = true;
        this.update({ camera: true });
      } catch {
        if (operation === this.operation && this.peer === peer)
          this.update({ error: "permission" });
      } finally {
        if (!adopted) capture?.getTracks().forEach((track) => track.stop());
      }
    } finally {
      this.cameraBusy = false;
    }
  }
  setDnd(dnd: boolean) {
    try {
      this.send({ type: "availability", dnd });
      this.update({ dnd });
    } catch {
      this.fail("network");
    }
  }
  private makePeer(mode: CallMode) {
    if (mode === "voice") {
      this.stream?.getVideoTracks().forEach((t) => {
        t.stop();
        this.stream?.removeTrack(t);
      });
      this.update({ camera: false });
    }
    const peer = new RTCPeerConnection({
      iceServers: this.session?.iceServers || [],
    });
    this.peer = peer;
    this.stream
      ?.getTracks()
      .forEach((track) => peer.addTrack(track, this.stream!));
    peer.onicecandidate = (event) => {
      if (this.peer !== peer || !event.candidate || !this.snapshot.call?.id)
        return;
      const c = event.candidate.toJSON();
      try {
        this.send({
          type: "signal",
          callId: this.snapshot.call.id,
          signal: {
            type: "ice",
            candidate: {
              candidate: c.candidate || "",
              sdpMid: c.sdpMid ?? null,
              sdpMLineIndex: c.sdpMLineIndex ?? null,
              usernameFragment: c.usernameFragment ?? null,
            },
          },
        });
      } catch {
        this.fail("network");
      }
    };
    peer.ontrack = (event) => {
      if (this.peer !== peer) return;
      if (!this.remote) this.remote = new MediaStream();
      this.remote.addTrack(event.track);
      if (this.mediaElement) {
        this.mediaElement.srcObject = this.remote;
        void this.play();
      }
    };
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer) return;
      if (peer.connectionState === "connected") {
        for (const sender of peer.getSenders())
          if (sender.track?.kind === "video") {
            const parameters = sender.getParameters();
            if (parameters.encodings.length) {
              parameters.encodings = parameters.encodings.map((e) => ({
                ...e,
                maxBitrate: 1_200_000,
              }));
              void sender.setParameters(parameters).catch(() => undefined);
            }
          }
        if (this.loss) clearTimeout(this.loss);
        this.loss = null;
        if (this.snapshot.call) {
          this.update({ call: { ...this.snapshot.call, phase: "active" } });
          this.timer(MAX_CALL_MS);
        }
      }
      if (peer.connectionState === "failed") {
        this.end();
        this.update({ error: "network" });
      }
      if (peer.connectionState === "disconnected" && !this.loss)
        this.loss = setTimeout(() => {
          if (this.peer === peer && peer.connectionState !== "connected") {
            this.end();
            this.update({ error: "network" });
          }
        }, 5_000);
    };
    return peer;
  }
  private async message(m: ServerCallMessage) {
    if (m.type === "ready") {
      this.update({ status: "ready", endpoints: m.endpoints });
      return;
    }
    if (m.type === "presence") {
      this.update({ endpoints: m.endpoints });
      return;
    }
    if (m.type === "error") {
      this.end();
      this.update({ error: m.code === "busy" ? "busy" : "unavailable" });
      return;
    }
    if (m.type === "ringing") {
      if (!m.incoming && (!this.snapshot.call || this.snapshot.call.incoming)) {
        this.send({ type: "end", callId: m.callId });
        return;
      }
      if (m.incoming && this.snapshot.call?.id === null) this.clearMedia();
      if (
        this.snapshot.call &&
        this.snapshot.call.id !== null &&
        this.snapshot.call.id !== m.callId
      )
        return;
      this.update({
        call: {
          id: m.callId,
          peer: m.peer,
          incoming: m.incoming,
          mode: m.mode,
          phase: "ringing",
        },
      });
      this.timer(RING_MS);
      return;
    }
    if (m.callId !== this.snapshot.call?.id) return;
    if (m.type === "ended") {
      this.clearMedia();
      this.update({
        call: null,
        muted: false,
        camera: false,
        needsPlay: false,
        error:
          m.reason === "ended"
            ? null
            : m.reason === "timeout"
              ? "timeout"
              : "unavailable",
      });
      return;
    }
    if (m.type === "accepted") {
      this.update({
        call: { ...this.snapshot.call!, mode: m.mode, phase: "connecting" },
      });
      this.timer(20_000);
      const peer = this.makePeer(m.mode),
        operation = this.operation;
      if (m.initiator) {
        await peer.setLocalDescription(await peer.createOffer());
        if (this.peer !== peer || operation !== this.operation) return;
        this.send({
          type: "signal",
          callId: m.callId,
          signal: { type: "offer", sdp: peer.localDescription!.sdp },
        });
      }
      return;
    }
    const peer = this.peer;
    if (!peer) return;
    if (m.signal.type === "ice") {
      if (peer.remoteDescription)
        await peer.addIceCandidate(m.signal.candidate);
      else if (this.ice.length < 64) this.ice.push(m.signal.candidate);
      return;
    }
    const operation = this.operation;
    await peer.setRemoteDescription({ type: m.signal.type, sdp: m.signal.sdp });
    if (this.peer !== peer || operation !== this.operation) return;
    for (const candidate of this.ice.splice(0)) {
      await peer.addIceCandidate(candidate);
      if (this.peer !== peer) return;
    }
    if (m.signal.type === "offer") {
      await peer.setLocalDescription(await peer.createAnswer());
      if (this.peer !== peer || operation !== this.operation) return;
      this.send({
        type: "signal",
        callId: m.callId,
        signal: { type: "answer", sdp: peer.localDescription!.sdp },
      });
    }
  }
}
