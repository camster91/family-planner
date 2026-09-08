const createMetric = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    betaMetricEvent: {
      create: (...args: unknown[]) => createMetric(...args),
    },
  },
}));

import { measureCoreMutation } from "@/lib/beta-metrics";

const context = {
  familyId: "family-1",
  actorRole: "child",
  eventName: "chore.complete" as const,
};

describe("measureCoreMutation", () => {
  beforeEach(() => {
    createMetric.mockReset();
    createMetric.mockResolvedValue({ id: "metric-1" });
  });

  it("records success only after the full operation resolves", async () => {
    const operation = jest.fn().mockResolvedValue({ alreadyCompleted: false });

    await expect(measureCoreMutation(context, operation)).resolves.toEqual({
      alreadyCompleted: false,
    });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(createMetric).toHaveBeenCalledWith({
      data: expect.objectContaining({
        family_id: "family-1",
        event_name: "chore.complete",
        success: true,
      }),
    });
  });

  it("skips duplicate-success metrics when the result predicate rejects them", async () => {
    await expect(
      measureCoreMutation(
        context,
        async () => ({ alreadyCompleted: true }),
        (result) => !result.alreadyCompleted,
      ),
    ).resolves.toEqual({ alreadyCompleted: true });

    expect(createMetric).not.toHaveBeenCalled();
  });

  it("records failure when the logical operation rejects", async () => {
    await expect(
      measureCoreMutation(context, async () => {
        throw new Error("activity write failed");
      }),
    ).rejects.toThrow("activity write failed");

    expect(createMetric).toHaveBeenCalledWith({
      data: expect.objectContaining({
        success: false,
      }),
    });
  });
});
