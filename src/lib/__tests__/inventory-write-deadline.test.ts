import { inventoryWriteDeadline } from "../inventory-write-deadline";
afterEach(() => jest.useRealTimers());
it("settles as unknown when a native bridge ignores cancellation and never settles", async () => {
  jest.useFakeTimers();
  const result = inventoryWriteDeadline(
    () => new Promise<{ kind: "confirmed" }>(() => undefined),
  );
  jest.advanceTimersByTime(15001);
  expect(await result).toEqual({ kind: "unknown" });
});
it("does not substitute a late confirmation for the already unknown returned outcome", async () => {
  jest.useFakeTimers();
  let complete!: (value: { kind: "confirmed" }) => void;
  const result = inventoryWriteDeadline(
    () =>
      new Promise<{ kind: "confirmed" }>((resolve) => {
        complete = resolve;
      }),
  );
  jest.advanceTimersByTime(15001);
  expect(await result).toEqual({ kind: "unknown" });
  complete({ kind: "confirmed" });
  expect(await result).toEqual({ kind: "unknown" });
});
