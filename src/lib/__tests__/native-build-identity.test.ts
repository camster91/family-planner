import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { readNativeBuildIdentity } from "@/lib/native-app";

jest.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: jest.fn(),
    isPluginAvailable: jest.fn(),
    getPlatform: jest.fn(),
  },
}));
jest.mock("@capacitor/app", () => ({ App: { getInfo: jest.fn() } }));
jest.mock("@capacitor/network", () => ({ Network: {} }));
jest.mock("@capacitor/share", () => ({ Share: {} }));
beforeEach(() => jest.resetAllMocks());

test("web identity has no fabricated installed build or plugin call", async () => {
  expect(await readNativeBuildIdentity()).toEqual({
    platform: "web",
    version: null,
    build: null,
  });
  expect(App.getInfo).not.toHaveBeenCalled();
});
test.each(["android", "ios"])(
  "records actual %s plugin version and build separately",
  async (platform) => {
    (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
    (Capacitor.isPluginAvailable as jest.Mock).mockReturnValue(true);
    (Capacitor.getPlatform as jest.Mock).mockReturnValue(platform);
    (App.getInfo as jest.Mock).mockResolvedValue({
      version: "1.0-ci.57",
      build: "57",
      id: "com.ashbi.familyplanner",
      name: "Family Planner",
    });
    expect(await readNativeBuildIdentity()).toEqual({
      platform,
      version: "1.0-ci.57",
      build: "57",
    });
  },
);
test("older installed shell without App plugin stays usable with unknown version", async () => {
  (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
  (Capacitor.getPlatform as jest.Mock).mockReturnValue("android");
  expect(await readNativeBuildIdentity()).toEqual({
    platform: "android",
    version: null,
    build: null,
  });
  expect(App.getInfo).not.toHaveBeenCalled();
});
test("plugin failure, unknown platform and malformed fields do not manufacture identity", async () => {
  (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
  (Capacitor.isPluginAvailable as jest.Mock).mockReturnValue(true);
  (Capacitor.getPlatform as jest.Mock).mockReturnValue("other");
  (App.getInfo as jest.Mock).mockRejectedValue(new Error("plugin unavailable"));
  expect(await readNativeBuildIdentity()).toEqual({
    platform: "unknown",
    version: null,
    build: null,
  });
  (App.getInfo as jest.Mock).mockResolvedValue({
    version: "contains private whitespace",
    build: "a".repeat(65),
  });
  expect(await readNativeBuildIdentity()).toEqual({
    platform: "unknown",
    version: null,
    build: null,
  });
});
