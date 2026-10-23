/** Authored source only; display/history must not grant archived action authority. */
import type { Prisma } from "@prisma/client";
import { readChoreSubject } from "../chore-profile";
import {
  isProfileChoreSubject,
  profileSubjectForVerify,
} from "../chore-profile-actions";
const row = {
  id: "archived-chore",
  family_id: "family-a",
  assigned_to: null,
  assigned_member_id: "member-a",
  member_subject_erased: false,
  assignee: null,
  recurrence_id: null,
  frequency: "once",
  assigneeMember: {
    id: "member-a",
    family_id: "family-a",
    name: "Retained profile",
    role: "child",
    age: 3,
    archived_at: new Date("2026-10-20T12:00:00Z"),
    erasure_user_id: null,
    legacy_mapping: null,
    account_link: null,
  },
};
it("keeps display identity separate from verify/reject authority", async () => {
  expect(readChoreSubject(row, "family-a")).toMatchObject({
    kind: "profile",
    memberId: "member-a",
    name: "Retained profile",
  });
  expect(isProfileChoreSubject(row, "family-a")).toBe(false);
  const find = jest.fn().mockResolvedValue(row),
    raw = jest.fn();
  const tx = {
    chore: { findFirst: find },
    $queryRaw: raw,
  } as unknown as Prisma.TransactionClient;
  expect(await profileSubjectForVerify(tx, row.id, "family-a")).toBeNull();
  expect(find).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: row.id, family_id: "family-a" } }),
  );
  expect(raw).not.toHaveBeenCalled();
});
it("does not widen erased, linked or cross-household subject authority", () => {
  expect(readChoreSubject(row, "foreign")).toBeNull();
  expect(
    readChoreSubject({ ...row, member_subject_erased: true }, "family-a"),
  ).toBeNull();
  expect(
    readChoreSubject(
      {
        ...row,
        assigneeMember: {
          ...row.assigneeMember,
          account_link: { user_id: "account" },
        },
      },
      "family-a",
    ),
  ).toBeNull();
  expect(
    isProfileChoreSubject(
      { ...row, assigneeMember: { ...row.assigneeMember, archived_at: null } },
      "family-a",
    ),
  ).toBe(true);
});
