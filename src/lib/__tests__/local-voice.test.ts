import { localVoiceResult, wakePhraseDraft } from "@/lib/local-voice";
jest.mock("@capacitor/core", () => ({
  registerPlugin: () => ({}),
  Capacitor: { getPlatform: () => "web", isPluginAvailable: () => false },
}));

describe("foreground wake-phrase draft boundary", () => {
  it.each([
    ["Hey herewoven, add milk", "add milk"],
    ["Hola here woven: comprar pan", "comprar pan"],
    ["HEY HEREWOVEN add bread", "add bread"],
    ["hey herewoven", null],
    ["please hey herewoven delete my account", null],
    ["hey herewovenish delete my account", null],
    ["add milk", null],
  ])("extracts only an explicit leading phrase from %s", (input, expected) => {
    expect(wakePhraseDraft(input!)).toBe(expected);
  });
  it("refuses oversized, unknown or mixed native results", () => {
    expect(
      localVoiceResult.safeParse({
        status: "transcript",
        text: "x".repeat(2001),
      }).success,
    ).toBe(false);
    expect(
      localVoiceResult.safeParse({ status: "executed", text: "done" }).success,
    ).toBe(false);
    expect(
      localVoiceResult.safeParse({ status: "denied", text: "private text" })
        .success,
    ).toBe(false);
  });
});
