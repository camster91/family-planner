import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Istanbul 1.x calls js-yaml.load. Our scoped js-yaml 4 override removes
// argparse 1 / sprintf-js; exercise the consumer API, including YAML extends.
const { loadNycConfig, isLoading } = require("@istanbuljs/load-nyc-config") as {
  loadNycConfig: (options: { cwd: string }) => Promise<Record<string, unknown>>;
  isLoading: () => boolean;
};

describe("Istanbul configuration with the supported YAML parser", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "family-coverage-config-"));
    writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ private: true }),
    );
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("loads YAML extensions, arrays, booleans, and hyphenated settings", async () => {
    writeFileSync(
      path.join(directory, "base.yaml"),
      "all: true\ninclude:\n  - src/**/*.ts\ncheck-coverage: true\n",
    );
    writeFileSync(
      path.join(directory, ".nycrc.yaml"),
      "extends: ./base.yaml\nexclude:\n  - src/**/__tests__/**\nbranches: 80\n",
    );

    await expect(loadNycConfig({ cwd: directory })).resolves.toEqual({
      cwd: directory,
      all: true,
      include: ["src/**/*.ts"],
      checkCoverage: true,
      exclude: ["src/**/__tests__/**"],
      branches: 80,
    });
    expect(isLoading()).toBe(false);
  });

  it("rejects malformed YAML and resets the loading state", async () => {
    writeFileSync(
      path.join(directory, ".nycrc.yaml"),
      "include: [unterminated\n",
    );
    await expect(loadNycConfig({ cwd: directory })).rejects.toThrow();
    expect(isLoading()).toBe(false);
  });
});
