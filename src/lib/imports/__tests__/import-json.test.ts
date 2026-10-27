/** Pure source cases authored UNRUN. No DB, provider, file or browser actions. */
import {
  parseImportJson,
  ImportJsonError,
  IMPORT_JSON_MAX_DEPTH,
} from "../import-json";
it.each([
  '{"id":1,"id":2}',
  '{"id":1,"id":1}',
  '{"data":{},"data":{}}',
  '{"kid-a":"user-a","kid-a":"user-b"}',
  String.raw`{"id":1,"\u0069d":2}`,
  String.raw`{"a\"b":1,"a\"b":2}`,
  '{"__proto__":1,"__proto__":2}',
  '{"records":[{"nested":{"id":1,"id":2}}]}',
])(
  "rejects repeated decoded object names without guessing a winner: %s",
  (text) => {
    expect(() => parseImportJson(text)).toThrow(ImportJsonError);
    try {
      parseImportJson(text);
    } catch (error) {
      expect(error).toMatchObject({
        code: "DUPLICATE_KEY",
        message: "Import JSON requires review",
      });
    }
  },
);
it("scopes names per object and leaves strings/Unicode/case/prototype-named data literal", () => {
  const text = String.raw`{"records":[{"id":"a"},{"id":"b"}],"quoted":"{\"id\":1,\"id\":2}","ID":3,"id":4,"__proto__":{"marker":"data"}}`;
  const value = parseImportJson(text);
  expect(value).toEqual(JSON.parse(text));
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
});
it.each([
  "",
  "{",
  "[1,]",
  '{"a":}',
  '{"a" 1}',
  '{"a":1} trailing',
  String.raw`{"bad\uZZZZ":1}`,
])("still refuses invalid native JSON syntax: %s", (text) => {
  expect(() => parseImportJson(text)).toThrow();
});
it("bounds nesting without rejecting ordinary repeated arrays or parsing a truncated prefix", () => {
  const atLimit =
    "[".repeat(IMPORT_JSON_MAX_DEPTH) + "0" + "]".repeat(IMPORT_JSON_MAX_DEPTH);
  expect(parseImportJson(atLimit)).toBeDefined();
  const beyond = "[" + atLimit + "]";
  expect(() => parseImportJson(beyond)).toThrow(ImportJsonError);
});
