import { createRequire } from "node:module";

const nextConfig = createRequire(__filename)("../../next.config.js");
type Owner = string | undefined;
type ModuleSource = { nameForCondition: () => string };
type Chunk = {
  canBeInitial: () => boolean;
  groupsIterable: { name: Owner; isInitial: () => boolean }[];
};
type Graph = { getModuleChunksIterable: () => Chunk[] };
type Group = {
  test: (source: ModuleSource, context: { chunkGraph: Graph }) => boolean;
};
const groups: Record<string, Group> = nextConfig.webpack(
  { optimization: { splitChunks: { cacheGroups: {} } } },
  { dev: false, isServer: false },
).optimization.splitChunks.cacheGroups;

function admitted(
  group: string,
  owners: Owner[],
  initial = true,
  resource = "/repo/src/components/providers/example.tsx",
) {
  return groups[group].test(
    { nameForCondition: () => resource },
    {
      chunkGraph: {
        getModuleChunksIterable: () => [
          {
            canBeInitial: () => initial,
            groupsIterable: owners.map((name) => ({
              name,
              isInitial: () => initial,
            })),
          },
        ],
      },
    },
  );
}

describe("shared layout chunks preserve initial entrypoint ownership", () => {
  test("accepts an unnamed chunk owned only by dashboard entrypoints", () => {
    expect(
      admitted("herewovenDashboardLayout", [
        "app/dashboard/layout",
        "app/dashboard/today/page",
      ]),
    ).toBe(true);
  });
  test("keeps a device consumer out of the dashboard-only chunk", () => {
    expect(
      admitted("herewovenDashboardLayout", [
        "app/dashboard/layout",
        "app/device/today/page",
      ]),
    ).toBe(false);
  });
  test("shares board code only when both surfaces already require it", () => {
    expect(
      admitted("herewovenBoardShell", [
        "app/dashboard/layout",
        "app/device/today/page",
        "app/dashboard/@forms/(.)chores/create/page",
      ]),
    ).toBe(true);
    expect(
      admitted("herewovenBoardShell", [
        "app/dashboard/layout",
        "app/dashboard/today/page",
      ]),
    ).toBe(false);
  });
  test.each(["app/(auth)/login/page", "app/device/pair/page", undefined])(
    "rejects an outside or unknown board owner: %s",
    (owner) => {
      expect(
        admitted("herewovenBoardShell", [
          "app/dashboard/layout",
          "app/device/today/page",
          owner,
        ]),
      ).toBe(false);
    },
  );
  test("never admits async-only feature modules", () => {
    expect(
      admitted(
        "herewovenBoardShell",
        ["app/dashboard/layout", "app/device/today/page"],
        false,
      ),
    ).toBe(false);
  });
  test("keeps CSS in its existing chunk pipeline", () => {
    expect(
      admitted(
        "herewovenBoardShell",
        ["app/dashboard/layout", "app/device/today/page"],
        true,
        "/repo/src/components/board.css",
      ),
    ).toBe(false);
  });
  test("deduplicates only known dynamic helpers with proved dashboard ownership", () => {
    const owners = ["app/dashboard/layout", "app/dashboard/today/page"];
    expect(
      admitted(
        "herewovenDashboardLayout",
        owners,
        true,
        "/repo/node_modules/next/dist/shared/lib/lazy-dynamic/loadable.js",
      ),
    ).toBe(true);
    expect(
      admitted(
        "herewovenDashboardLayout",
        [...owners, "app/(auth)/login/page"],
        true,
        "/repo/node_modules/next/dist/shared/lib/lazy-dynamic/loadable.js",
      ),
    ).toBe(false);
    expect(
      admitted(
        "herewovenDashboardLayout",
        owners,
        false,
        "/repo/node_modules/next/dist/shared/lib/lazy-dynamic/loadable.js",
      ),
    ).toBe(false);
  });
  test("leaves unrelated framework and validation modules in their own pipeline", () => {
    const owners = ["app/dashboard/layout", "app/dashboard/today/page"];
    expect(
      admitted(
        "herewovenDashboardLayout",
        owners,
        true,
        "/repo/node_modules/next/dist/shared/lib/lazy-dynamic/future.js",
      ),
    ).toBe(false);
    expect(
      admitted(
        "herewovenDashboardLayout",
        owners,
        true,
        "/repo/node_modules/next/dist/client/unrelated.js",
      ),
    ).toBe(false);
    expect(
      admitted(
        "herewovenDashboardLayout",
        owners,
        true,
        "/repo/node_modules/zod/v4/classic/schemas.js",
      ),
    ).toBe(false);
  });
  test("root code still requires initial root ownership", () => {
    expect(
      admitted("herewovenRootLayout", ["app/layout", "app/(auth)/login/page"]),
    ).toBe(true);
    expect(admitted("herewovenRootLayout", ["app/dashboard/layout"])).toBe(
      false,
    );
  });
});
