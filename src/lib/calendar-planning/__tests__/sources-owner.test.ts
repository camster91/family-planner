// Authored UNRUN: bounded source display shares the original planner owner.
import { fetchPlanningRange, fetchPlanningSources } from "../fetch";
import { CALENDAR_OWNER_HEADER, CalendarReadOwnerChanged } from "@/lib/calendar-read-owner";
import { calendarReadOwnerFixture as owner, calendarReadOwnerHeaders } from "@/__tests__/helpers/calendar-read-owner";

it("sends the original on the first range page, even before any rows have loaded", async () => {
  const request = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({ok:true,headers:calendarReadOwnerHeaders(),json:async () => ({events:[],hasMore:false})}) as unknown as Response);
  await fetchPlanningRange("2026-01-01T00:00:00Z","2026-01-02T00:00:00Z",new AbortController().signal,request,10,{owner});
  expect(new Headers(request.mock.calls[0][1]?.headers).get(CALENDAR_OWNER_HEADER)).toBe(JSON.stringify(owner));
});
it("returns only admitted source display fields", async () => {
  const request = jest.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({ok:true,headers:calendarReadOwnerHeaders(),json:async () => ({subscriptions:[{id:"s",name:"School",color:null,url_hint:"private-hint",url_enc:"private-encrypted-url"}]})}) as unknown as Response);
  const admit = jest.fn(() => true);
  expect(await fetchPlanningSources(new AbortController().signal,{owner,admit},request)).toEqual([{id:"s",name:"School",color:null}]);
  expect(admit).toHaveBeenCalledWith(owner);
  expect(new Headers(request.mock.calls[0][1]?.headers).get(CALENDAR_OWNER_HEADER)).toBe(JSON.stringify(owner));
});
it("does not decode source data from another owner", async () => {
  const json = jest.fn();
  const headers = new Headers({[CALENDAR_OWNER_HEADER]:JSON.stringify({...owner,familyId:"family-B"})});
  await expect(fetchPlanningSources(new AbortController().signal,{owner},jest.fn(async () => ({ok:true,headers,json}) as unknown as Response)))
    .rejects.toBeInstanceOf(CalendarReadOwnerChanged);
  expect(json).not.toHaveBeenCalled();
});
it.each([400,401,403,404,409])("holds on access refusal %s without reading its body", async status => {
  const json = jest.fn();
  await expect(fetchPlanningSources(new AbortController().signal,{owner},jest.fn(async () => ({ok:false,status,json}) as unknown as Response)))
    .rejects.toBeInstanceOf(CalendarReadOwnerChanged);
  expect(json).not.toHaveBeenCalled();
});
