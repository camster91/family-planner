/** @jest-environment jsdom */
// Source cases authored UNRUN. No upload/provider/API request was performed.
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BoardSettings, { personBoardSettingsTransport } from '../BoardSettings';
import { I18nProvider } from '@/i18n';
import { boardSettingsEnglish } from '@/i18n/board-settings';
const data = { weather: { available: false, enabled: false, place: null, unit: 'celsius' as const }, members: [] };
afterEach(() => { jest.useRealTimers(); });
it('bounds a stalled personal load body and ignores its late result', async () => {
  let late!: (value: unknown) => void;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { late = resolve; }) })) as unknown as typeof fetch;
  jest.useFakeTimers();
  const result = personBoardSettingsTransport.load().then(() => 'unexpected', error => error.message);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await jest.advanceTimersByTimeAsync(15001); });
  expect(await result).toBe(boardSettingsEnglish.loadError);
  late(data); expect(await result).toBe(boardSettingsEnglish.loadError);
});
it('keeps an unconfirmed save as one exact attempt and does not automatically retry', async () => {
  global.fetch = jest.fn(async () => await new Promise<Response>(() => undefined));
  jest.useFakeTimers();
  const patch = { weather: { enabled: true } };
  const result = personBoardSettingsTransport.save(patch).then(() => 'unexpected', error => error.message);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await jest.advanceTimersByTimeAsync(45001); });
  expect(await result).toBe(boardSettingsEnglish.unconfirmed);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect((global.fetch as jest.Mock).mock.calls[0][1].body).toBe(JSON.stringify(patch));
});
it('refuses a declared oversized response before decoding', async () => {
  const decode = jest.fn(async () => data);
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': String(2 * 1024 * 1024 + 1) }), json: decode })) as unknown as typeof fetch;
  await expect(personBoardSettingsTransport.load()).rejects.toThrow(boardSettingsEnglish.loadError);
  expect(decode).not.toHaveBeenCalled();
});
it('offers an explicit load retry while preserving custom transport error semantics', async () => {
  const transport = { load: jest.fn().mockRejectedValueOnce(new Error('Fixture unavailable')).mockResolvedValue(data), save: jest.fn(), searchPlaces: jest.fn() };
  render(<I18nProvider><BoardSettings transport={transport} /></I18nProvider>);
  await screen.findByText('Fixture unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Try loading again' }));
  await waitFor(() => expect(transport.load).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Fixture unavailable')).toBeNull();
  expect(transport.save).not.toHaveBeenCalled();
});

it('ignores a retired custom save after the transport audience changes', async () => {
  const oldData = { ...data, members: [{ id: 'old-member', name: 'Old parent', color: 'indigo' as const, custom: false }] };
  const newData = { ...data, members: [{ id: 'new-member', name: 'New parent', color: 'sky' as const, custom: false }] };
  let finish!: (value: typeof oldData) => void;
  const oldTransport = { load: jest.fn(async () => oldData), save: jest.fn(() => new Promise<typeof oldData>(resolve => { finish = resolve; })), searchPlaces: jest.fn() };
  const nextTransport = { load: jest.fn(async () => newData), save: jest.fn(), searchPlaces: jest.fn() };
  const view = render(<I18nProvider><BoardSettings transport={oldTransport} /></I18nProvider>);
  const select = await screen.findByLabelText('Old parent');
  fireEvent.change(select, { target: { value: 'sky' } });
  await waitFor(() => expect(oldTransport.save).toHaveBeenCalledTimes(1));
  view.rerender(<I18nProvider><BoardSettings transport={nextTransport} /></I18nProvider>);
  await screen.findByLabelText('New parent');
  await act(async () => { finish(oldData); });
  expect(screen.queryByLabelText('Old parent')).toBeNull();
  expect(screen.getByLabelText('New parent')).toBeTruthy();
  expect(nextTransport.save).not.toHaveBeenCalled();
});
