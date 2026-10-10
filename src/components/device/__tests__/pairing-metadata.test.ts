/** @jest-environment jsdom */
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { getPairingMetadata } from "../PairScreen";

jest.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: jest.fn(),
    isNativePlatform: jest.fn(),
  },
}));

jest.mock("@capacitor/app", () => ({
  App: {
    getInfo: jest.fn(),
  },
}));

const getPlatform = Capacitor.getPlatform as jest.Mock;
const isNativePlatform = Capacitor.isNativePlatform as jest.Mock;
const getInfo = App.getInfo as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  getPlatform.mockReturnValue("web");
  isNativePlatform.mockReturnValue(false);
});

it("reports the Android platform and native versionName", async () => {
  isNativePlatform.mockReturnValue(true);
  getPlatform.mockReturnValue("android");
  getInfo.mockResolvedValue({ version: "1.0-ci.57" });

  await expect(getPairingMetadata()).resolves.toEqual({
    platform: "android",
    appVersion: "1.0-ci.57",
  });
  expect(getInfo).toHaveBeenCalledTimes(1);
});

it("uses the existing web contract in browsers and does not call native App APIs", async () => {
  await expect(getPairingMetadata()).resolves.toEqual({
    platform: "web",
    appVersion: "web",
  });
  expect(getInfo).not.toHaveBeenCalled();
});

it("does not mislabel an iOS shell as Android while the API has no iOS platform", async () => {
  isNativePlatform.mockReturnValue(true);
  getPlatform.mockReturnValue("ios");

  await expect(getPairingMetadata()).resolves.toEqual({
    platform: "web",
    appVersion: "web",
  });
  expect(getInfo).not.toHaveBeenCalled();
});

it("uses an explicit unknown version when an Android App plugin is unavailable", async () => {
  isNativePlatform.mockReturnValue(true);
  getPlatform.mockReturnValue("android");
  getInfo.mockRejectedValue(new Error("plugin unavailable"));

  await expect(getPairingMetadata()).resolves.toEqual({
    platform: "android",
    appVersion: "unknown",
  });
});
