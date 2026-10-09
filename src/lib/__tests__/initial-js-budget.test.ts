import {
  CORE_JS_BUDGETS,
  enforceJavaScriptBudget,
  measureInitialJavaScript,
} from "../../../scripts/initial-js-budget";

const origin = "http://127.0.0.1:3161";
const asset = (path: string, body = "export const value = 'fixture';") => ({
  url: `${origin}/_next/static/${path}.js`,
  body: Buffer.from(body),
});

it("counts unique downloaded files and fails exactly above the existing budget", () => {
  const one = asset("chunks/one");
  const two = asset("chunks/two", "export const value = 'another fixture';");
  const measured = measureInitialJavaScript(origin, [
    one,
    two,
    { ...one, url: `${one.url}?cache=fixture` },
  ]);
  expect(measured.files).toHaveLength(2);
  expect(measured.gzipBytes).toBe(
    measureInitialJavaScript(origin, [one]).gzipBytes +
      measureInitialJavaScript(origin, [two]).gzipBytes,
  );
  expect(() =>
    enforceJavaScriptBudget(measured, measured.gzipBytes),
  ).not.toThrow();
  expect(() =>
    enforceJavaScriptBudget(measured, measured.gzipBytes - 1),
  ).toThrow("exceeds");
  expect(CORE_JS_BUDGETS).toEqual({
    today: 250000,
    calendar: 300000,
    chores: 300000,
    lists: 300000,
    meals: 300000,
    settings: 300000,
  });
});

it.each([
  "https://third-party.example.test/sdk.js",
  `${origin}/private-data.js`,
  `${origin}/_next/static/../secret.js`,
  `${origin}/_next/static/%2e%2e/secret.js`,
  `${origin}/_next/static/chunk.js#fragment`,
  "http://user:password@127.0.0.1:3161/_next/static/chunk.js",
])("rejects unexpected script locations (%s)", (url) => {
  expect(() =>
    measureInitialJavaScript(origin, [{ url, body: Buffer.from("fixture") }]),
  ).toThrow();
});

it("fails closed on missing bodies, missing scripts and inconsistent duplicate downloads", () => {
  expect(() => measureInitialJavaScript(origin, [])).toThrow("No initial");
  expect(() => measureInitialJavaScript(origin, [asset("empty", "")])).toThrow(
    "no response body",
  );
  expect(() =>
    measureInitialJavaScript(origin, [
      asset("same"),
      asset("same", "different"),
    ]),
  ).toThrow("changed");
  expect(() =>
    enforceJavaScriptBudget(
      measureInitialJavaScript(origin, [asset("one")]),
      Number.NaN,
    ),
  ).toThrow("Invalid");
});
