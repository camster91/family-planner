import { Capacitor, registerPlugin } from "@capacitor/core";
import { z } from "zod";

export const LOCAL_VOICE_PREVIEW =
  process.env.NEXT_PUBLIC_LOCAL_VOICE_PREVIEW === "1";
export const localVoiceResult = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("transcript"),
      text: z.string().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      status: z.enum([
        "cancelled",
        "unavailable",
        "denied",
        "timeout",
        "no-input",
      ]),
    })
    .strict(),
]);
type LocalVoicePlugin = {
  availability(): Promise<{ available: boolean }>;
  listen(options: {
    requestId: string;
    language: "en" | "es";
  }): Promise<unknown>;
  cancel(options: { requestId: string }): Promise<void>;
};
export const LocalVoice = registerPlugin<LocalVoicePlugin>("LocalVoice");
/** Plugin presence is measured separately from actual local recognizer/model readiness. */
export function hasLocalVoice() {
  return (
    LOCAL_VOICE_PREVIEW &&
    Capacitor.getPlatform() === "android" &&
    Capacitor.isPluginAvailable("LocalVoice")
  );
}
/** A foreground phrase experiment, not speaker identification or background wake detection. */
export function wakePhraseDraft(text: string): string | null {
  const match = text
    .normalize("NFC")
    .match(/^\s*(?:hey|hola)[,\s]+here\s*woven\b[\s,:.!?—-]*(.*)$/iu);
  return match?.[1]?.trim() || null;
}
