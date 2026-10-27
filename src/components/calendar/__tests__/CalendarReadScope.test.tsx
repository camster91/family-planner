/** @jest-environment jsdom */
// Authored UNRUN. Owner retirement is monotonic across mounted refreshes.
import { act, renderHook } from "@testing-library/react";
import { useCalendarReadScope } from "../CalendarReadScope";
import { calendarReadOwnerFixture as owner } from "@/__tests__/helpers/calendar-read-owner";
import type { CalendarReadOwner } from "@/lib/calendar-read-owner";

const typedOwner: CalendarReadOwner = owner;

it("holds immediately on changed server props and cannot revive when old props return", () => {
  const { result, rerender } = renderHook(({ initial }) => useCalendarReadScope(initial), {initialProps:{initial:typedOwner}});
  const original = result.current;
  rerender({initial:{...typedOwner,familyId:"family-B"}});
  expect(result.current.held).toBe(true);
  expect(result.current.owner).toEqual(typedOwner);
  rerender({initial:typedOwner});
  expect(result.current).toBe(original);
  expect(result.current.held).toBe(true);
});
it("uses one first owner for racing range and source admissions", () => {
  const { result } = renderHook(() => useCalendarReadScope());
  let first = false, second = true;
  act(() => { first = result.current.admit(typedOwner); second = result.current.admit({...typedOwner,actorId:"other-account"}); });
  expect(first).toBe(true);
  expect(second).toBe(false);
  expect(result.current.held).toBe(true);
  expect(result.current.owner).toEqual(typedOwner);
  expect(result.current.admit(typedOwner)).toBe(false);
});
it("pins admission before body success, rather than adopting a later retry owner", () => {
  const {result} = renderHook(() => useCalendarReadScope());
  act(() => { result.current.admit(typedOwner); });
  // The original response body may fail after this point. No body success is
  // necessary to retain the original owner for the next request.
  expect(result.current.owner).toEqual(typedOwner);
  act(() => { result.current.admit({...typedOwner,generation:1}); });
  expect(result.current.held).toBe(true);
});
