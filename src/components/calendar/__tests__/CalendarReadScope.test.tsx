/** @jest-environment jsdom */
// Authored UNRUN. Owner retirement is monotonic across mounted refreshes.
import { act, renderHook } from "@testing-library/react";
import { useCalendarReadScope } from "../CalendarReadScope";
import { calendarReadOwnerFixture as owner } from "@/__tests__/helpers/calendar-read-owner";

it("holds immediately on changed server props and cannot revive when old props return", () => {
  const { result, rerender } = renderHook(({ initial }) => useCalendarReadScope(initial), {initialProps:{initial:owner}});
  const original = result.current;
  rerender({initial:{...owner,familyId:"family-B"}});
  expect(result.current.held).toBe(true);
  expect(result.current.owner).toEqual(owner);
  rerender({initial:owner});
  expect(result.current).toBe(original);
  expect(result.current.held).toBe(true);
});
it("uses one first owner for racing range and source admissions", () => {
  const { result } = renderHook(() => useCalendarReadScope());
  let first = false, second = true;
  act(() => { first = result.current.admit(owner); second = result.current.admit({...owner,actorId:"other-account"}); });
  expect(first).toBe(true);
  expect(second).toBe(false);
  expect(result.current.held).toBe(true);
  expect(result.current.owner).toEqual(owner);
  expect(result.current.admit(owner)).toBe(false);
});
it("pins admission before body success, rather than adopting a later retry owner", () => {
  const {result} = renderHook(() => useCalendarReadScope());
  act(() => { result.current.admit(owner); });
  // The original response body may fail after this point. No body success is
  // necessary to retain the original owner for the next request.
  expect(result.current.owner).toEqual(owner);
  act(() => { result.current.admit({...owner,generation:1}); });
  expect(result.current.held).toBe(true);
});
