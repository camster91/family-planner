import { overlappingEvents } from "../view";

const range = { start: "2026-01-05T00:00:00Z", end: "2026-01-06T00:00:00Z" };
const event = (id: string, start: string, end: string) => ({
  id,
  start_time: start,
  end_time: end,
});

it("reports actual intersections, excluding adjacent, zero-length and invalid events", () => {
  const first = event("a", "2026-01-05T09:00:00Z", "2026-01-05T11:00:00Z");
  const second = event("b", "2026-01-05T10:00:00Z", "2026-01-05T12:00:00Z");
  const result = overlappingEvents(
    [
      first,
      second,
      event("c", "2026-01-05T12:00:00Z", "2026-01-05T13:00:00Z"),
      event("zero", first.start_time, first.start_time),
      event("invalid", "invalid", second.end_time),
    ],
    range,
  );
  expect(result).toEqual({
    total: 1,
    pairs: [
      {
        first,
        second,
        start: second.start_time.replace("Z", ".000Z"),
        end: first.end_time.replace("Z", ".000Z"),
      },
    ],
  });
});

it("deduplicates stored IDs and clips continuing events to the visible range", () => {
  const first = event("a", "2026-01-04T23:00:00Z", "2026-01-05T01:00:00Z");
  const second = event("b", "2026-01-04T22:00:00Z", "2026-01-06T01:00:00Z");
  const result = overlappingEvents(
    [
      first,
      second,
      first,
      event("outside", "2026-01-06T00:00:00Z", "2026-01-07T00:00:00Z"),
    ],
    range,
  );
  expect(result.total).toBe(1);
  expect(result.pairs[0]).toMatchObject({
    start: "2026-01-05T00:00:00.000Z",
    end: "2026-01-05T01:00:00.000Z",
  });
});

it("counts dense overlap pairs without building an unbounded preview", () => {
  const events = Array.from({ length: 2000 }, (_, i) =>
    event(String(i), "2026-01-05T09:00:00Z", "2026-01-05T10:00:00Z"),
  );
  const result = overlappingEvents(events, range);
  expect(result.total).toBe(1999000);
  expect(result.pairs).toHaveLength(3);
  expect(overlappingEvents([...events].reverse(), range)).toEqual(result);
});

it("compares real instants across offset changes without a false wall-clock overlap", () => {
  const a = event(
    "a",
    "2026-11-01T01:00:00-04:00",
    "2026-11-01T01:30:00-04:00",
  );
  const b = event(
    "b",
    "2026-11-01T01:00:00-05:00",
    "2026-11-01T01:30:00-05:00",
  );
  expect(
    overlappingEvents([a, b], {
      start: "2026-11-01T00:00:00Z",
      end: "2026-11-02T00:00:00Z",
    }).total,
  ).toBe(0);
  expect(
    overlappingEvents([a, b], { start: "invalid", end: range.end }),
  ).toEqual({ total: 0, pairs: [] });
});
