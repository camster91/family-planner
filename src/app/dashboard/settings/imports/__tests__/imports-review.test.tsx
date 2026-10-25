/** @jest-environment jsdom */
// Deferred source cases only; no import, database or runtime acceptance ran.
import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import RawImportsClient from "../ImportsClient";
import { IMPORT_OWNER_HEADER, IMPORT_OWNER_PROTOCOL } from "@/lib/imports/import-owner-contract";
const owner = { protocol: IMPORT_OWNER_PROTOCOL, actorId: "fixture-parent", familyId: "fixture-family", generation: 0 } as const;
const ImportsClient = () => <RawImportsClient owner={owner} />;
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const review = { protocol: 1, actorId: "fixture-parent", familyId: "fixture-family" };
const preview = { review, originalOwner: owner, plan: { fixture: true }, summary: { created: {}, reused: {}, skipped: [] }, jobId: null };
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

it.each(["review", "originalOwner"])("refuses persistence when a server omits %s metadata", async missing => {
  const legacy: Record<string, unknown> = { ...preview };
  delete legacy[missing];
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

it('uses only the strict endpoint with the original owner header', async () => {
  global.fetch = jest.fn(async () => response(preview)) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file('synthetic-owned.json', async () => '{"fixture":true}'));
  await screen.findByText('synthetic-owned.json');
  fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
  await screen.findByRole('heading', { name: 'Reconciliation preview' });
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe('/api/admin/imports/chore-champs/owned');
  expect(new Headers(init.headers).get(IMPORT_OWNER_HEADER)).toBe(JSON.stringify(owner));
});
it('keeps a file local if older server props lack original-owner support', async () => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  render(<RawImportsClient />);
  choose(file('synthetic-local.json', async () => '{"fixture":true}'));
  await screen.findByText('synthetic-local.json');
  expect((screen.getByRole('button', { name: 'Validate dry run' }) as HTMLButtonElement).disabled).toBe(true);
  expect(global.fetch).not.toHaveBeenCalled();
});
it('masks the old file and preview after a household or generation prop change instead of rebinding', async () => {
  global.fetch = jest.fn(async () => response(preview)) as unknown as typeof fetch;
  const { rerender } = render(<RawImportsClient owner={owner} />);
  choose(file('synthetic-private.json', async () => '{"fixture":true}'));
  await screen.findByText('synthetic-private.json');
  rerender(<RawImportsClient owner={{ ...owner, generation: 1 }} />);
  expect(screen.queryByText('synthetic-private.json')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Validate dry run' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Reload imports' })).toBeTruthy();
  expect(global.fetch).not.toHaveBeenCalled();
});
it('refuses a successful preview returned under a different original owner', async () => {
  global.fetch = jest.fn(async () => response({ ...preview, originalOwner: { ...owner, familyId: 'other-family' } })) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file('synthetic-mismatch.json', async () => '{"fixture":true}'));
  await screen.findByText('synthetic-mismatch.json');
  fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
  await screen.findByRole('button', { name: 'Reload imports' });
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Reconciliation preview' })).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('holds a missing strict endpoint without sending any legacy fallback', async () => {
  const decode = jest.fn();
  global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: decode })) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file('synthetic-upgrade.json', async () => '{"fixture":true}'));
  await screen.findByText('synthetic-upgrade.json');
  fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
  await screen.findByText(/This server cannot confirm the reviewed household/);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('/api/admin/imports/chore-champs/owned');
  expect(decode).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Validate dry run' }) as HTMLButtonElement).disabled).toBe(true);
});

it('retires a denied session before decoding an unreadable private reply', async () => {
  const decode = jest.fn(async () => await new Promise(() => undefined));
  global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: decode })) as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file('synthetic-retired.json', async () => '{"fixture":true}'));
  await screen.findByText('synthetic-retired.json');
  fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
  await screen.findByRole('button', { name: 'Reload imports' });
  expect(decode).not.toHaveBeenCalled();
  expect(screen.queryByText('synthetic-retired.json')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
describe('owned file read recovery source (unrun)', () => {
  afterEach(() => jest.useRealTimers());
  it('releases a stalled read, ignores its late contents and permits selecting the same file again', async () => {
    jest.useFakeTimers();
    let finish!: (text: string) => void;
    const read = jest.fn().mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; })).mockResolvedValue('{"fixture":"current"}');
    const selected = file('synthetic-retry.json', read);
    global.fetch = jest.fn() as unknown as typeof fetch;
    render(<ImportsClient />);
    choose(selected);
    await waitFor(() => expect(finish).toBeDefined());
    await act(async () => { jest.advanceTimersByTime(15_000); });
    await screen.findByText(/That file could not be read/);
    expect(screen.queryByText('Reading export file…')).toBeNull();
    expect(screen.queryByText('synthetic-retry.json')).toBeNull();
    await act(async () => { finish('{"fixture":"late-old"}'); });
    expect(screen.queryByText('synthetic-retry.json')).toBeNull();
    choose(selected);
    await screen.findByText('synthetic-retry.json');
    expect(read).toHaveBeenCalledTimes(2);
    expect((screen.getByRole('button', { name: 'Validate dry run' }) as HTMLButtonElement).disabled).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('checks decoded UTF-8 size even if bridge file metadata understated it', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    render(<ImportsClient />);
    // A fabricated text-only bridge reports a tiny File but yields >10MiB UTF-8.
    const text = JSON.stringify({ fixture: '€'.repeat(Math.floor(10 * 1024 * 1024 / 3) + 1) });
    choose(file('synthetic-overflow.json', async () => text));
    await screen.findByText('Export files must be 10 MB or smaller.');
    expect(screen.queryByText('synthetic-overflow.json')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// Raw JSON ambiguity cases authored only; deferred with the rest of QA.
it('rejects duplicate export fields locally without requesting a preview', async () => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file('ambiguous.json', async () => '{"fixture":1,"fixture":2}'));
  await screen.findByText('The export repeats a JSON field. Review the original export before trying again.');
  expect(screen.queryByText('ambiguous.json')).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});
it('requires one target per raw identity-map key before dispatch', async () => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  render(<ImportsClient />);
  choose(file('unambiguous.json', async () => '{"fixture":true}'));
  await screen.findByText('unambiguous.json');
  fireEvent.change(screen.getByLabelText('Identity mapping'), { target: { value: '{"source":"target-a","source":"target-b"}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Validate dry run' }));
  await screen.findByText('The identity map repeats a source ID. Choose one target for each source ID.');
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
});
