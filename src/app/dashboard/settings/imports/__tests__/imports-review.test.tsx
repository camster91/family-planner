/** @jest-environment jsdom */
// Deferred source cases only; no import, database or runtime acceptance ran.
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ImportsClient from "../ImportsClient";
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const preview = { plan: { fixture: true }, summary: { created: {}, reused: {}, skipped: [] }, jobId: null };
const response = (body: unknown) => ({ ok: true, json: async () => body });
function file(name: string, contents: () => Promise<string>) {
  const value = new File(["fixture"], name, { type: "application/json" });
  Object.defineProperty(value, "text", { value: contents });
  return value;
}
function choose(value: File) {
  fireEvent.change(document.getElementById("importFile")!, { target: { files: [value] } });
}
it("uses the current reviewed payload and consumes approval on the first persistence attempt", async () => {
  const requests: Array<Record<string, unknown>> = [];
  global.fetch = jest.fn(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)); requests.push(payload);
    return response({ ...preview, jobId: payload.dryRun ? null : "fixture-job" });
  }) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file("fixture.json", async () => '{"fixture":"latest"}'));
  await screen.findByText("fixture.json");
  fireEvent.click(screen.getByRole("button", { name: "Validate dry run" }));
  await screen.findByRole("heading", { name: "Reconciliation preview" });
  fireEvent.change(screen.getByLabelText("Identity mapping"), { target: { value: '{"source-user":"fixture-user"}' } });
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Validate dry run" }));
  await screen.findByRole("heading", { name: "Reconciliation preview" });
  fireEvent.click(screen.getByRole("checkbox"));
  const persist = screen.getByRole("button", { name: "Persist approved import" });
  fireEvent.click(persist); fireEvent.click(persist);
  await screen.findByRole("heading", { name: "Import result" });
  expect(requests).toHaveLength(3);
  expect(requests[2]).toEqual({ ...requests[1], dryRun: false });
  expect(requests[2].identityMap).toEqual({ "source-user": "fixture-user" });
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
});
it("keeps a lost persistence response unknown and requires a new preview before another write", async () => {
  let writes = 0;
  global.fetch = jest.fn(async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    if (!payload.dryRun) { writes++; throw new TypeError("Fabricated lost response"); }
    return response(preview);
  }) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file("fixture.json", async () => '{"fixture":true}'));
  await screen.findByText("fixture.json");
  fireEvent.click(screen.getByRole("button", { name: "Validate dry run" }));
  await screen.findByRole("heading", { name: "Reconciliation preview" });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Persist approved import" }));
  await screen.findByText(/The import result could not be confirmed/);
  expect((screen.getByRole("button", { name: "Persist approved import" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect(writes).toBe(1);
});
it("does not replace a later file selection with an older asynchronous file read", async () => {
  let finish!: (text: string) => void;
  const slow = file("old.json", () => new Promise(resolve => { finish = resolve; }));
  global.fetch = jest.fn(async () => response(preview)) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(slow);
  choose(file("current.json", async () => '{"fixture":"current"}'));
  await screen.findByText("current.json");
  await act(async () => { finish('{"fixture":"old"}'); });
  expect(screen.queryByText("old.json")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Validate dry run" }));
  await screen.findByRole("heading", { name: "Reconciliation preview" });
  expect(JSON.parse(String((global.fetch as jest.Mock).mock.calls[0][1].body)).data).toEqual({ fixture: "current" });
});
