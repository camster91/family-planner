import type { Prisma } from "@prisma/client";
import { deleteOptionalHouseholdMetadataInTx } from "../account-deletion-optional";

const cases = [
  ["choreTopUpCursor", "ChoreTopUpCursor"],
  ["householdProfileLinkChallenge", "HouseholdProfileLinkChallenge"],
  ["aiUsageRequest", "AiUsageRequest"],
  ["aiUsagePolicy", "AiUsagePolicy"],
] as const;
function fixture(present: boolean) {
  const query = jest.fn(async () => [{ present }]);
  const execute = jest.fn(async () => 2);
  // No Prisma delegates: this must work with an older generated client too.
  const tx = { $queryRaw: query, $executeRaw: execute };
  return { tx: tx as unknown as Prisma.TransactionClient, query, execute };
}
it.each(cases)(
  "deletes %s only with a bound household value",
  async (model, table) => {
    const { tx, query, execute } = fixture(true);
    await deleteOptionalHouseholdMetadataInTx(tx, "family-a", model);
    expect(
      (query.mock.calls[0] as unknown as [TemplateStringsArray])[0].join("?"),
    ).toBe(`SELECT to_regclass('public."${table}"') IS NOT NULL AS present`);
    const [sql, ...values] = execute.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(sql.join("?")).toBe(`DELETE FROM "${table}" WHERE "family_id" = ?`);
    expect(values).toEqual(["family-a"]);
  },
);
it.each(cases)(
  "skips absent %s during rollback without issuing a delete",
  async (model) => {
    const { tx, execute } = fixture(false);
    await deleteOptionalHouseholdMetadataInTx(tx, "family-a", model);
    expect(execute).not.toHaveBeenCalled();
  },
);
it.each(cases)(
  "propagates %s probe and deletion failures to the transaction",
  async (model) => {
    const probe = fixture(true);
    probe.query.mockRejectedValueOnce(new Error("fixture probe failure"));
    await expect(
      deleteOptionalHouseholdMetadataInTx(probe.tx, "family-a", model),
    ).rejects.toThrow("fixture probe failure");
    expect(probe.execute).not.toHaveBeenCalled();
    const deletion = fixture(true);
    deletion.execute.mockRejectedValueOnce(
      new Error("fixture deletion failure"),
    );
    await expect(
      deleteOptionalHouseholdMetadataInTx(deletion.tx, "family-a", model),
    ).rejects.toThrow("fixture deletion failure");
  },
);
