import { calendarReadOwnerFixture, calendarReadOwnerHeaders } from "@/__tests__/helpers/calendar-read-owner";
import { CALENDAR_OWNER_HEADER, CalendarReadOwnerChanged } from "@/lib/calendar-read-owner";
import { fetchPlanningRange } from "../fetch";
const start = "2026-01-01T00:00:00Z", end = "2026-01-08T00:00:00Z";
const event = (id: string) => ({id,title:"Fixture event",start_time:"2026-01-04T12:00:00Z",end_time:"2026-01-04T13:00:00Z",event_type:"other"});
it("rejects repeated cursors instead of silently accepting incomplete data", async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(
      response({ events: [event("a")], hasMore: true, nextCursor: "same" }),
    )
    .mockResolvedValueOnce(
      response({ events: [event("b")], hasMore: true, nextCursor: "same" }),
    )
    .mockRejectedValue(new Error("test safety stop"));
  await expect(
    fetchPlanningRange(start, end, new AbortController().signal, request),
  ).rejects.toThrow("paging");
  expect(request).toHaveBeenCalledTimes(2);
});
it("stops at an explicit page budget, returning a truncation flag", async () => {
  let i = 0;
  const request = jest.fn(async () => {
    if (i >= 2) throw new Error("test safety stop");
    return response({
      events: [event(String(++i))],
      hasMore: true,
      nextCursor: String(i),
    });
  });
  const result = await fetchPlanningRange(
    start,
    end,
    new AbortController().signal,
    request,
    2,
  );
  expect(result.truncated).toBe(true);
  expect(result.events).toHaveLength(2);
});
it("rejects failed responses, malformed paging and aborted requests", async () => {
  await expect(
    fetchPlanningRange(
      start,
      end,
      new AbortController().signal,
      jest.fn(async () => ({ ok: false }) as Response),
    ),
  ).rejects.toThrow("could not load");
  await expect(
    fetchPlanningRange(
      start,
      end,
      new AbortController().signal,
      jest.fn(async () =>
        response({ events: [], hasMore: true, nextCursor: null }),
      ),
    ),
  ).rejects.toThrow("paging");
  const controller = new AbortController();
  controller.abort();
  await expect(
    fetchPlanningRange(
      start,
      end,
      controller.signal,
      jest.fn(async () => response({ events: [], hasMore: false })),
    ),
  ).rejects.toThrow();
});
const response = (body: unknown) =>
  ({ ok: true, headers: calendarReadOwnerHeaders(), json: async () => body }) as Response;
it("reads every cursor page with the same bounded range and signal", async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(
      response({ events: [event("a")], hasMore: true, nextCursor: "next" }),
    )
    .mockResolvedValueOnce(
      response({ events: [event("b")], hasMore: false, nextCursor: null }),
    );
  const signal = new AbortController().signal;
  const result = await fetchPlanningRange(
    "2026-01-01T00:00:00Z",
    "2026-01-08T00:00:00Z",
    signal,
    request,
  );
  expect(result.events.map((e) => e.id)).toEqual(["a", "b"]);
  expect(result.truncated).toBe(false);
  expect(request.mock.calls[1][0]).toContain("cursor=next");
  expect(request.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  expect(request.mock.calls[1][1].signal).toBe(request.mock.calls[0][1].signal);
});

// Authored UNRUN: whole-range deadline and projection boundary cases.
afterEach(() => jest.useRealTimers());
it('rejects a stalled later page at the overall deadline instead of returning a partial calendar', async () => {
  jest.useFakeTimers();
  const request = jest.fn().mockResolvedValueOnce(response({events:[event('a')],hasMore:true,nextCursor:'next'}))
    .mockImplementationOnce(() => new Promise(() => undefined));
  const pending = fetchPlanningRange(start,end,new AbortController().signal,request);
  const refusal = expect(pending).rejects.toThrow('could not load');
  await jest.advanceTimersByTimeAsync(30_000);
  await refusal;
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][1].signal.aborted).toBe(true);
});
it('refuses an oversized page without decoding it', async () => {
  const json = jest.fn();
  const request = jest.fn(async () => ({ok:true,headers:new Headers({...Object.fromEntries(calendarReadOwnerHeaders()),'content-length':String(8 * 1024 * 1024 + 1)}),json}) as unknown as Response);
  await expect(fetchPlanningRange(start,end,new AbortController().signal,request)).rejects.toThrow('could not load');
  expect(json).not.toHaveBeenCalled();
});
it.each([
  [{...event('a'),title:{private:'invalid'}}],
  [{...event('a'),end_time:'invalid'}],
  [event('a'),event('a')],
])('refuses inconsistent event objects before rendering', async events => {
  await expect(fetchPlanningRange(start,end,new AbortController().signal,
    jest.fn(async () => response({events,hasMore:false,nextCursor:null})))).rejects.toThrow('paging');
});
it('returns only the validated planning fields without a hidden write or extra request', async () => {
  const request = jest.fn(async () => response({events:[{...event('a'),privateExtra:'discard'}],hasMore:false,nextCursor:null}));
  const result = await fetchPlanningRange(start,end,new AbortController().signal,request);
  expect(result).toEqual({events:[event('a')],truncated:false});
  expect(request).toHaveBeenCalledTimes(1);
});
it('refuses invalid page budgets before dispatch', async () => {
  const request = jest.fn();
  await expect(fetchPlanningRange(start,end,new AbortController().signal,request,0)).rejects.toThrow('paging');
  expect(request).not.toHaveBeenCalled();
});

// Authored UNRUN: paging is bound to the first admitted response owner.
it.each([
  {actorId:'other-parent'}, {familyId:'family-B'}, {role:'teen'}, {generation:1},
])('withholds partial results and never decodes a changed-owner page (%j)', async change => {
  const json = jest.fn(async () => ({events:[event('b')],hasMore:false}));
  const headers = new Headers({[CALENDAR_OWNER_HEADER]:JSON.stringify({...calendarReadOwnerFixture,...change})});
  const request = jest.fn().mockResolvedValueOnce(response({events:[event('a')],hasMore:true,nextCursor:'next'}))
    .mockResolvedValueOnce({ok:true,headers,json});
  await expect(fetchPlanningRange(start,end,new AbortController().signal,request)).rejects.toBeInstanceOf(CalendarReadOwnerChanged);
  expect(json).not.toHaveBeenCalled();
  expect(request.mock.calls[1][1].headers[CALENDAR_OWNER_HEADER]).toBe(JSON.stringify(calendarReadOwnerFixture));
});
it.each([null,'{}','not-json'])('refuses a missing or invalid response owner before body decoding (%s)', async marker => {
  const headers = new Headers();
  if (marker !== null) headers.set(CALENDAR_OWNER_HEADER,marker);
  const json = jest.fn();
  await expect(fetchPlanningRange(start,end,new AbortController().signal,
    jest.fn(async () => ({ok:true,headers,json}) as unknown as Response))).rejects.toBeInstanceOf(CalendarReadOwnerChanged);
  expect(json).not.toHaveBeenCalled();
});
