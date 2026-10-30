/** Diagnostic UI only; media/signaling behavior is the actual product controller. */
import {
  CallingClient,
  callingSessionSchema,
} from "../../../src/lib/calling/client";
const tracks: MediaStreamTrack[] = [],
  media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async (constraints) => {
  const stream = await media(constraints);
  tracks.push(...stream.getTracks());
  return stream;
};
const client = new CallingClient(async (_label, signal) =>
  callingSessionSchema.parse(
    await (
      await fetch("/__fixture/session", { method: "POST", signal })
    ).json(),
  ),
);
const status = document.querySelector("#status")!,
  roster = document.querySelector("#roster")!;
const remote = document.querySelector<HTMLVideoElement>("#remote")!;
client.setMediaElement(remote);
client.subscribe(() => {
  const s = client.getSnapshot();
  status.textContent = JSON.stringify({
    status: s.status,
    call: s.call,
    camera: s.camera,
    error: s.error,
  });
  roster.replaceChildren(
    ...s.endpoints.map((endpoint) => {
      const b = document.createElement("span");
      b.textContent = endpoint.label;
      return b;
    }),
  );
});
function button(id: string, action: () => void) {
  document.querySelector(id)!.addEventListener("click", action);
}
button("#enable", () => {
  void (async () => {
    const person = new URL(location.href).searchParams.get("person") || "a";
    await fetch("/__fixture/bootstrap?person=" + person, { method: "POST" });
    await client.connect("Fixture device");
  })();
});
button("#voice", () => {
  const target = client.getSnapshot().endpoints[0];
  if (target) void client.dial(target, "voice");
});
button("#video", () => {
  const target = client.getSnapshot().endpoints[0];
  if (target) void client.dial(target, "video");
});
button("#answer-voice", () => void client.answer("voice"));
button("#answer-video", () => void client.answer("video"));
button("#camera", () => void client.toggleCamera());
button("#end", () => client.end());
button("#heartbeat", () =>
  (client as unknown as { send(message: unknown): void }).send({
    type: "heartbeat",
  }),
);
Object.assign(window, {
  qa: {
    client,
    tracks,
    stats: async () => {
      const peer = (client as unknown as { peer: RTCPeerConnection | null })
        .peer;
      return peer ? [...(await peer.getStats()).values()] : [];
    },
  },
});
