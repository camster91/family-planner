// Render the real TabBar in Node: Playwright's JSX transform is not React SSR.
// Only the router pathname is supplied; role/feature selection and links are real.
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
const load = Module._load;
const role = process.argv[2];
const pathname =
  role === "parent" ? "/dashboard/calendar" : "/dashboard/emergency";
Module._load = function (id, ...args) {
  if (id === "next/navigation") return { usePathname: () => pathname };
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
const { TabBar } = require("../../src/components/ui/tab-bar");
const {
  FeaturesProvider,
} = require("../../src/components/providers/features-provider");
const { defaultFeatures } = require("../../src/lib/features");
const layout = fs.readFileSync(
  path.join(root, "src/app/dashboard/layout.tsx"),
  "utf8",
);
const mainClass = layout.match(/id="main-content"\s+className="([^"]+)"/)[1];
if (process.argv[2] === "--browser") {
  const output = path.resolve(process.argv[3]);
  const dir = path.dirname(output);
  fs.mkdirSync(dir, { recursive: true });
  const loader = path.join(dir, "tsx-loader.cjs");
  fs.writeFileSync(
    loader,
    `const ts = require(${JSON.stringify(require.resolve("typescript"))}); module.exports = function(source) { return ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: this.resourcePath }).outputText; };`,
  );
  const router = path.join(dir, "pathname.cjs");
  fs.writeFileSync(router, "exports.usePathname = () => window.__tabPathname;");
  const entry = path.join(dir, "hydrate.cjs");
  fs.writeFileSync(
    entry,
    `const React = require(${JSON.stringify(require.resolve("react"))}); const { hydrateRoot } = require(${JSON.stringify(require.resolve("react-dom/client"))}); const { TabBar } = require(${JSON.stringify(path.join(root, "src/components/ui/tab-bar.tsx"))}); const { FeaturesProvider } = require(${JSON.stringify(path.join(root, "src/components/providers/features-provider.tsx"))}); const { defaultFeatures } = require(${JSON.stringify(path.join(root, "src/lib/features.ts"))}); const role = window.__tabRole; window.__tabPathname = role === 'parent' ? '/dashboard/calendar' : '/dashboard/emergency'; window.__tabRoot = hydrateRoot(document.getElementById('tab-reflow-nav'), React.createElement(FeaturesProvider, { initial: defaultFeatures() }, React.createElement(TabBar, { user: { id: 'synthetic-nav', name: 'Example', avatar_url: null, role } })));`,
  );
  const webpack = require("next/dist/compiled/webpack/webpack").webpack;
  webpack(
    {
      mode: "development",
      target: "web",
      devtool: false,
      entry,
      output: { path: dir, filename: path.basename(output) },
      resolve: {
        extensions: [".tsx", ".ts", ".js", ".cjs"],
        alias: { "@": path.join(root, "src"), "next/navigation$": router },
        modules: [path.join(root, "node_modules")],
      },
      module: { rules: [{ test: /\.tsx?$/, use: loader }] },
      plugins: [
        new webpack.DefinePlugin({
          "process.env": JSON.stringify({ NODE_ENV: "development" }),
        }),
      ],
    },
    (error, stats) => {
      if (error || stats.hasErrors()) {
        console.error(error || stats.toString({ all: false, errors: true }));
        process.exitCode = 1;
      } else process.stdout.write(output);
    },
  );
} else {
  process.stdout.write(
    renderToStaticMarkup(
      React.createElement(
        FeaturesProvider,
        { initial: defaultFeatures(), canManage: role === "parent" },
        React.createElement(
          "div",
          { className: "min-h-screen bg-[var(--surface-grouped)]" },
          React.createElement(
            "main",
            { id: "main-content", className: mainClass },
            React.createElement(
              "div",
              {
                className:
                  "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 md:py-6",
              },
              React.createElement(
                "p",
                null,
                "Labelled synthetic TabBar reflow fixture — no household data",
              ),
              React.createElement("div", { style: { height: 1200 } }),
              React.createElement(
                "button",
                { id: "bottom-action", className: "btn-filled" },
                "Last content action",
              ),
            ),
          ),
          React.createElement(
            "div",
            { id: "tab-reflow-nav" },
            React.createElement(TabBar, {
              user: {
                id: "synthetic-nav",
                name: "Example",
                avatar_url: null,
                role,
              },
            }),
          ),
        ),
      ),
    ),
  );
}
