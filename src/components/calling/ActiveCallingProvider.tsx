"use client";
import * as React from "react";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  Volume2,
} from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import {
  CallingClient,
  callingSessionSchema,
  type CallingSnapshot,
} from "@/lib/calling/client";
import { requestOwnedJson, runOwnedForeground } from "@/lib/owned-request-http";
import type { DeviceClient } from "@/lib/device-client";
import { useCallingText, type CallingTextKey } from "@/i18n/calling";
import { CallingContext } from "./CallingProvider";
export default function ActiveCallingProvider({
  identityKey,
  deviceClient,
  children,
}: {
  identityKey: string;
  deviceClient?: DeviceClient | null;
  children: React.ReactNode;
}) {
  const text = useCallingText(),
    [open, setOpen] = React.useState(false),
    [name, setName] = React.useState(""),
    [optedIn, setOptedIn] = React.useState(false),
    [sound, setSound] = React.useState(false);
  const ringer = React.useRef<AudioContext | null>(null),
    latestName = React.useRef(name);
  latestName.current = name;
  const sessionLoader = React.useCallback(
    async (label: string, signal: AbortSignal) => {
      const init = {
        method: "POST" as const,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
        signal,
      };
      if (deviceClient) {
        const result = await runOwnedForeground(
          async () => ({
            kind: "reply" as const,
            data: await deviceClient.request("/api/device/calls/session", {
              method: "POST",
              body: {},
              optionalRoute: true,
            }),
          }),
          { signal, timeoutMs: 12_000 },
        );
        if (result.kind !== "reply") throw Error("Calling unavailable");
        return callingSessionSchema.parse(result.data);
      }
      const response = await requestOwnedJson(
        "/api/calls/session",
        init,
        40_000,
      );
      if (response.kind !== "reply" || !response.response.ok)
        throw Error("Calling unavailable");
      return callingSessionSchema.parse(response.body);
    },
    [deviceClient],
  );
  const client = React.useMemo(
    () => new CallingClient(sessionLoader),
    [sessionLoader],
  );
  const state = React.useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  );
  const preference = "herewoven-calling-v1:" + identityKey;
  React.useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(preference) || "null");
      if (
        raw?.version === 1 &&
        typeof raw.name === "string" &&
        raw.name.trim().length <= 40
      ) {
        setName(raw.name);
        setOptedIn(raw.enabled === true);
      }
    } catch {
      /* optional local preference */
    }
  }, [preference]);
  React.useEffect(() => {
    if (!optedIn) {
      client.disconnect();
      return;
    }
    const connect = () => {
      if (document.visibilityState !== "hidden")
        void client.connect(
          latestName.current.trim() ||
            text(deviceClient ? "deviceLabel" : "newDevice"),
        );
    };
    const changed = () =>
      document.visibilityState === "hidden" ? client.disconnect() : connect();
    const pageHide = () => client.disconnect();
    connect();
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("pagehide", pageHide);
    return () => {
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("pagehide", pageHide);
      client.disconnect();
    };
    // Name changes apply on the next explicit connect, not on each keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, optedIn]);
  React.useEffect(
    () => () => {
      void ringer.current?.close();
    },
    [],
  );
  const primeSound = async () => {
    try {
      if (!ringer.current) ringer.current = new AudioContext();
      await ringer.current.resume();
      setSound(ringer.current.state === "running");
    } catch {
      setSound(false);
    }
  };
  React.useEffect(() => {
    if (
      !state.call?.incoming ||
      state.call.phase !== "ringing" ||
      !sound ||
      !ringer.current
    )
      return;
    const beep = () => {
      const ctx = ringer.current;
      if (ctx?.state !== "running") return;
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      oscillator.frequency.value = 660;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.03);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.4);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    };
    beep();
    const timer = setInterval(beep, 1800);
    return () => clearInterval(timer);
  }, [state.call?.id, state.call?.incoming, state.call?.phase, sound]);
  const setAvailability = (enabled: boolean) => {
    setOptedIn(enabled);
    try {
      localStorage.setItem(
        preference,
        JSON.stringify({ version: 1, name: name.trim().slice(0, 40), enabled }),
      );
    } catch {
      /* calling remains usable without storage */
    }
    if (enabled) void primeSound();
  };
  const context = React.useMemo(
    () => ({ open: () => setOpen(true), client }),
    [client],
  );
  const errorKey = (
    state.error === "busy" ? "busyError" : state.error
  ) as CallingTextKey | null;
  const call = state.call;
  return (
    <CallingContext.Provider value={context}>
      {children}
      <Dialog
        open={open && !call}
        onClose={() => setOpen(false)}
        title={text("title")}
        variant="form"
        testId="family-call-picker"
      >
        <div className="space-y-4 pb-3">
          <p className="text-sm text-label-secondary">{text("intro")}</p>
          {!deviceClient && (
            <label className="block text-sm text-label-primary">
              {text("deviceName")}
              <input
                className="input-apple mt-2"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={40}
                placeholder={text("placeholder")}
                disabled={optedIn}
              />
            </label>
          )}
          <p role="status" className="text-sm text-label-secondary">
            {text(
              state.status === "ready"
                ? "ready"
                : state.status === "connecting"
                  ? "connecting"
                  : "off",
            )}
          </p>
          {errorKey && (
            <p role="alert" className="text-sm text-danger-text">
              {text(errorKey)}
            </p>
          )}
          {!optedIn ? (
            <>
              <button
                type="button"
                className="btn-filled min-h-11"
                onClick={() => setAvailability(true)}
              >
                {text("enable")}
              </button>
              <p className="text-sm text-label-secondary">
                {text("permissionNote")}
              </p>
            </>
          ) : (
            <>
              {state.status === "unavailable" && (
                <button
                  type="button"
                  className="btn-tinted min-h-11"
                  onClick={() =>
                    void client.connect(
                      name.trim() ||
                        text(deviceClient ? "deviceLabel" : "newDevice"),
                    )
                  }
                >
                  {text("retry")}
                </button>
              )}
              {state.status === "ready" && (
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={state.dnd}
                    onChange={(e) => client.setDnd(e.target.checked)}
                  />
                  {text("dnd")}
                </label>
              )}
              {state.status === "ready" && !state.endpoints.length && (
                <p className="text-label-secondary">
                  {text("empty")}{" "}
                  <span className="block mt-1 text-sm">
                    {text("emptyHelp")}
                  </span>
                </p>
              )}
              <ul className="divide-y divide-[var(--surface-separator)]">
                {state.endpoints.map((endpoint) => (
                  <li
                    key={endpoint.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <span className="min-w-0 break-words text-label-primary">
                      {endpoint.label}
                      <span className="block text-sm text-label-secondary">
                        {text(
                          endpoint.status === "available"
                            ? "available"
                            : endpoint.status === "busy"
                              ? "busy"
                              : "dnd",
                        )}
                      </span>
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-tinted min-h-11 min-w-11"
                        disabled={
                          state.status !== "ready" ||
                          endpoint.status !== "available" ||
                          state.dnd
                        }
                        aria-label={text("voiceTo", endpoint.label)}
                        onClick={() => void client.dial(endpoint, "voice")}
                      >
                        <Phone size={19} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn-tinted min-h-11 min-w-11"
                        disabled={
                          state.status !== "ready" ||
                          endpoint.status !== "available" ||
                          state.dnd
                        }
                        aria-label={text("videoTo", endpoint.label)}
                        onClick={() => void client.dial(endpoint, "video")}
                      >
                        <Video size={19} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-plain min-h-11"
                  onClick={() => void primeSound()}
                >
                  <Volume2 size={18} aria-hidden="true" />
                  {text(sound ? "soundReady" : "sound")}
                </button>
                <button
                  type="button"
                  className="btn-plain min-h-11"
                  onClick={() => setAvailability(false)}
                >
                  {text("disable")}
                </button>
              </div>
            </>
          )}
          <p className="text-sm text-label-secondary">{text("foreground")}</p>
        </div>
      </Dialog>
      <Dialog
        open={!!call}
        title={
          call?.incoming && call.phase === "ringing"
            ? text(call.mode === "video" ? "incomingVideo" : "incomingVoice")
            : text("title")
        }
        variant="form"
        testId="family-active-call"
      >
        {call && (
          <div className="space-y-4 pb-3">
            <p className="text-xl font-semibold break-words">
              {call.peer.label}
            </p>
            <p role="status" className="text-label-secondary">
              {text(
                call.phase === "preparing"
                  ? call.mode === "video"
                    ? "preparingVideo"
                    : "preparing"
                  : call.phase === "ringing"
                    ? "ringing"
                    : call.phase === "active"
                      ? "active"
                      : "connecting",
              )}
            </p>
            <CallMedia client={client} state={state} />
            {errorKey && (
              <p role="alert" className="text-sm text-danger-text">
                {text(errorKey)}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {call.incoming && call.phase === "ringing" ? (
                <>
                  <button
                    type="button"
                    className="btn-filled min-h-11"
                    onClick={() => void client.answer("voice")}
                  >
                    <Phone size={18} aria-hidden="true" />
                    {text("answerVoice")}
                  </button>
                  {call.mode === "video" && (
                    <button
                      type="button"
                      className="btn-filled min-h-11"
                      onClick={() => void client.answer("video")}
                    >
                      <Video size={18} aria-hidden="true" />
                      {text("answerVideo")}
                    </button>
                  )}
                </>
              ) : (
                call.phase !== "preparing" && (
                  <>
                    <button
                      type="button"
                      className="btn-tinted min-h-11"
                      aria-pressed={state.muted}
                      onClick={() => client.mute()}
                    >
                      {state.muted ? (
                        <MicOff size={18} aria-hidden="true" />
                      ) : (
                        <Mic size={18} aria-hidden="true" />
                      )}
                      {text(state.muted ? "unmute" : "mute")}
                    </button>
                    {call.mode === "video" &&
                      (call.phase === "active" ||
                        call.phase === "connecting") && (
                        <button
                          type="button"
                          className="btn-tinted min-h-11"
                          aria-pressed={state.camera}
                          onClick={() => void client.toggleCamera()}
                        >
                          {state.camera ? (
                            <VideoOff size={18} aria-hidden="true" />
                          ) : (
                            <Video size={18} aria-hidden="true" />
                          )}
                          {text(state.camera ? "cameraOff" : "cameraOn")}
                        </button>
                      )}
                  </>
                )
              )}
              <button
                type="button"
                className="btn-tinted min-h-11 text-danger-text"
                onClick={() => client.end()}
              >
                <PhoneOff size={18} aria-hidden="true" />
                {text(
                  call.incoming && call.phase === "ringing"
                    ? "decline"
                    : call.phase === "preparing" || call.phase === "ringing"
                      ? "cancel"
                      : "end",
                )}
              </button>
            </div>
            {state.needsPlay && (
              <button
                type="button"
                className="btn-filled min-h-11"
                onClick={() => void client.play()}
              >
                <Volume2 size={18} aria-hidden="true" />
                {text("play")}
              </button>
            )}
            <p className="text-sm text-label-secondary">{text("maxCall")}</p>
          </div>
        )}
      </Dialog>
    </CallingContext.Provider>
  );
}
function CallMedia({
  client,
  state,
}: {
  client: CallingClient;
  state: CallingSnapshot;
}) {
  const text = useCallingText(),
    local = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => {
    if (local.current) local.current.srcObject = client.getLocalStream();
  }, [client, state.camera, state.call?.phase]);
  const setRemote = React.useCallback(
    (element: HTMLMediaElement | null) => client.setMediaElement(element),
    [client],
  );
  return state.call?.mode === "video" ? (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video
        ref={setRemote}
        autoPlay
        playsInline
        aria-label={text("remoteVideo")}
        className="w-full max-h-[40dvh] min-h-36 object-contain"
      />
      {state.camera && (
        <video
          ref={local}
          autoPlay
          playsInline
          muted
          aria-label={text("localPreview")}
          className="absolute bottom-2 right-2 w-24 sm:w-32 rounded-xl border border-white/40"
        />
      )}
    </div>
  ) : (
    <audio ref={setRemote} autoPlay aria-label={text("play")} />
  );
}
