// Render the actual menu after its trigger is clicked. Only routing and the
// feature-provider boundary are fixture inputs; this is not a live DB journey.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "../..");
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "http://localhost",
});
global.window = dom.window;
global.self = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require("react");
const { createRoot } = require("react-dom/client");
const { act } = React;
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(
    this,
    id.startsWith("@/") ? path.join(root, "src", id.slice(2)) : id,
    ...args,
  );
};
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === "next/navigation")
    return {
      usePathname: () => "/dashboard",
      useRouter: () => ({ push() {}, refresh() {} }),
    };
  if (id === "@/components/providers/features-provider")
    return {
      useFeatures: () => ({
        features: {
          ...require(path.join(root, "src/lib/features")).defaultFeatures(),
          inventory: true,
        },
      }),
    };
  if (id === "@/lib/offline-queue-browser")
    return { clearAllPersonQueues: async () => undefined };
  return load.call(this, id, ...args);
};
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const { outputText } = ts.transpileModule(
      fs.readFileSync(filename, "utf8"),
      {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
        fileName: filename,
      },
    );
    module._compile(outputText, filename);
  };
}
async function main() {
  const DashboardNav =
    require("../../src/components/layout/DashboardNav").default;
  const component = createRoot(document.getElementById("root"));
  await act(async () =>
    component.render(
      React.createElement(DashboardNav, {
        user: {
          id: "synthetic-child",
          name: "Example Child",
          role: "child",
          avatar_url: null,
        },
      }),
    ),
  );
  await act(async () =>
    document.querySelector('[aria-label="User menu"]').click(),
  );
  process.stdout.write(document.getElementById("root").innerHTML);
  await act(async () => component.unmount());
  dom.window.close();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
