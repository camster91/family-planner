// Real SSR component markup for browser contrast tests. Playwright's own JSX
// transform produces locator descriptors, not React elements, so render in Node
// with the project's TypeScript compiler and real React/Next components.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "../..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(
    this,
    id.startsWith("@/") ? path.join(root, "src", id.slice(2)) : id,
    ...args,
  );
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
const { DinnerRegion } = require("../../src/components/fridge/regions");
const mealsEnabled = process.argv[2] === "true";
const privateMode = process.argv[3] === "private";
process.stdout.write(
  renderToStaticMarkup(
    React.createElement(DinnerRegion, {
      dinner: null,
      mealsEnabled,
      mealsHref: privateMode ? null : "/dashboard/meals",
      featuresHref: privateMode ? null : "/dashboard/features",
    }),
  ),
);
