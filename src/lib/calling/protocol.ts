import { z } from "zod";
export const CALL_PROTOCOL = "herewoven.calls.v1";
export const RING_MS = 30_000;
export const MAX_CALL_MS = 30 * 60_000;
export const HEARTBEAT_MS = 15_000;
export const MAX_FRAME_BYTES = 32_768;
export const endpointSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(60),
  kind: z.enum(["person", "device"]),
  status: z.enum(["available", "busy", "dnd"]),
});
export type CallEndpoint = z.infer<typeof endpointSchema>;
const id = z.string().uuid();
export const signalSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("offer"), sdp: z.string().min(1).max(24_000) })
    .strict(),
  z
    .object({ type: z.literal("answer"), sdp: z.string().min(1).max(24_000) })
    .strict(),
  z
    .object({
      type: z.literal("ice"),
      candidate: z
        .object({
          candidate: z.string().max(2_048),
          sdpMid: z.string().max(64).nullable(),
          sdpMLineIndex: z.number().int().min(0).max(20).nullable(),
          usernameFragment: z.string().max(256).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
]);
export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heartbeat") }).strict(),
  z.object({ type: z.literal("availability"), dnd: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("call"),
      target: id,
      mode: z.enum(["voice", "video"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("accept"),
      callId: id,
      mode: z.enum(["voice", "video"]),
    })
    .strict(),
  z.object({ type: z.literal("end"), callId: id }).strict(),
  z
    .object({ type: z.literal("signal"), callId: id, signal: signalSchema })
    .strict(),
]);
export type ClientCallMessage = z.infer<typeof clientMessageSchema>;
export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    endpointId: id,
    endpoints: z.array(endpointSchema).max(24),
  }),
  z.object({
    type: z.literal("presence"),
    endpoints: z.array(endpointSchema).max(24),
  }),
  z.object({
    type: z.literal("ringing"),
    callId: id,
    peer: endpointSchema,
    incoming: z.boolean(),
    mode: z.enum(["voice", "video"]),
  }),
  z.object({
    type: z.literal("accepted"),
    callId: id,
    initiator: z.boolean(),
    mode: z.enum(["voice", "video"]),
  }),
  z.object({ type: z.literal("signal"), callId: id, signal: signalSchema }),
  z.object({
    type: z.literal("ended"),
    callId: id,
    reason: z.enum(["ended", "unavailable", "timeout"]),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["unavailable", "busy", "invalid", "limit"]),
  }),
]);
export type ServerCallMessage = z.infer<typeof serverMessageSchema>;
export type CallActor = { familyId: string; label: string } & (
  | { kind: "person"; userId: string; generation: number }
  | { kind: "device"; deviceId: string; sessionId: string }
);
