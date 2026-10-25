/** @jest-environment jsdom */
// Deferred source cases only; no import, database or runtime acceptance ran.
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ImportsClient from "../ImportsClient";
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const review = { protocol: 1, actorId: "fixture-parent", familyId: "fixture-family" };
const preview = { review, plan: { fixture: true }, summary: { created: {}, reused: {}, skipped: [] }, jobId: null };
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
  expect(requests[2]).toEqual({ ...requests[1], dryRun: false, expectedScope: { actorId: review.actorId, familyId: review.familyId } });
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

it("refuses persistence when an older server omits reviewed scope metadata", async () => {
  const legacy = { plan: preview.plan, summary: preview.summary, jobId: preview.jobId };
  global.fetch = jest.fn(async () => response(legacy)) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file("fixture.json", async () => '{"fixture":true}'));
  await screen.findByText("fixture.json");
  fireEvent.click(screen.getByRole("button", { name: "Validate dry run" }));
  await screen.findByText(/This server cannot confirm the reviewed household/);
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it('shows a bounded duplicate-record pointer without enabling approval', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'Invalid source export', duplicateSourceIds: [{ collection: 'chores', rowIndex: 1 }] }) })) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file('synthetic-duplicate.json', async () => '{"fixture":true}'));
  await screen.findByText('synthetic-duplicate.json');
  fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
  await screen.findByText('In chores, record 2 repeats an earlier source ID. Review the export before trying again.');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  choose(file('synthetic-replacement.json', async () => '{"fixture":"replacement"}'));
  await screen.findByText('synthetic-replacement.json');
  expect(screen.queryByText(/record 2 repeats/)).toBeNull();
});
it('keeps the generic invalid-export error when duplicate diagnostic metadata is malformed', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'Invalid source export', duplicateSourceIds: [{ collection: 'chores', rowIndex: -1 }] }) })) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file('synthetic-invalid.json', async () => '{"fixture":true}'));
  await screen.findByText('synthetic-invalid.json');
  fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
  await screen.findByRole('alert');
  expect(screen.queryByText(/repeats an earlier source ID/)).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
});
describe('bounded import transport source (unrun)', () => {
  afterEach(() => { jest.useRealTimers(); });
  it('releases a stalled preview without enabling approval', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => await new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    render(<ImportsClient />);
    choose(file('synthetic-stalled.json', async () => '{"fixture":true}'));
    await screen.findByText('synthetic-stalled.json');
    fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { jest.advanceTimersByTime(15_000); });
    await screen.findByText(/Could not validate this import/);
    expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
    expect((screen.getByRole('button', { name: 'Validate dry run' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('keeps an abort-ignoring persistence body unknown and ignores its late success', async () => {
    jest.useFakeTimers();
    let finish!: (body: unknown) => void;
    global.fetch = jest.fn(async (_url, init) => {
      if (JSON.parse(String(init?.body)).dryRun) return response(preview);
      return { ok: true, json: () => new Promise(resolve => { finish = resolve; }) };
    }) as unknown as typeof fetch;
    render(<ImportsClient />);
    choose(file('synthetic-unknown.json', async () => '{"fixture":true}'));
    await screen.findByText('synthetic-unknown.json');
    fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
    await screen.findByRole('heading', { name: 'Reconciliation preview' });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Persist approved import' }));
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => { jest.advanceTimersByTime(90_000); });
    await screen.findByText(/The import result could not be confirmed/);
    expect((global.fetch as jest.Mock).mock.calls[1][1].signal.aborted).toBe(true);
    expect((screen.getByRole('button', { name: 'Persist approved import' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish({ ...preview, jobId: 'synthetic-late-job', plan: { late: 'late-success-must-stay-hidden' } }); });
    expect(screen.queryByText(/late-success-must-stay-hidden/)).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
  it('refuses a declared oversized preview before JSON decoding or approval', async () => {
    const decode = jest.fn(async () => preview);
    global.fetch = jest.fn(async () => ({ ok: true, headers: new Headers({ 'content-length': String(16 * 1024 * 1024 + 1) }), json: decode })) as unknown as typeof fetch;
    render(<ImportsClient />);
    choose(file('synthetic-large-reply.json', async () => '{"fixture":true}'));
    await screen.findByText('synthetic-large-reply.json');
    fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
    await screen.findByText(/Could not validate this import/);
    expect(decode).not.toHaveBeenCalled();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
