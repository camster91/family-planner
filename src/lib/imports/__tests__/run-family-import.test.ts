import { isFamilyImportSource, runFamilyImport } from "../run-family-import";

describe("family import dispatcher", () => {
  it("allowlists only supported source apps", () => {
    expect(isFamilyImportSource("chore-champs")).toBe(true);
    expect(isFamilyImportSource("meal-planner")).toBe(true);
    expect(isFamilyImportSource("budget-app")).toBe(true);
    expect(isFamilyImportSource("../budget-app")).toBe(false);
  });

  it("keeps dispatched Budget App imports dry-run by default", async () => {
    const result = await runFamilyImport({
      source: "budget-app",
      familyId: "family-1",
      startedBy: "parent-1",
      data: { version: "1" },
    });
    expect(result.jobId).toBeNull();
    expect(result.plan.sourceVersion).toBe("1");
  });
});
