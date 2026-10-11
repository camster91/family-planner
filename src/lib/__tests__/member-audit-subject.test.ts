import fs from "node:fs";
import path from "node:path";
import { eraseAccountProfilesInTx } from "@/lib/household-member-lifecycle";

const ROOT = path.resolve(__dirname, "../../..");

describe("member audit-subject expand contract", () => {
  it("keeps Activity and DeviceAuditEvent actors and adds same-household tombstoned subjects", () => {
    const schema = fs.readFileSync(
      path.join(ROOT, "prisma/schema.prisma"),
      "utf8",
    );
    for (const model of ["Activity", "DeviceAuditEvent"]) {
      const block =
        new RegExp(`model ${model} \\{([\\s\\S]*?)^\\}`, "m").exec(
          schema,
        )?.[1] ?? "";
      expect(block).toMatch(/subject_member_id\s+String\?/);
      expect(block).toMatch(/subject_member_erased\s+Boolean/);
      expect(block).toContain("references: [id, family_id]");
      expect(block).toContain("onDelete: NoAction");
      expect(block).toContain("onUpdate: NoAction");
    }
    expect(schema).toMatch(/user\s+User\s+@relation\("UserActivities"/);
    expect(schema).toMatch(/actor\s+User\?\s+@relation\("DeviceAuditActor"/);
    expect(schema).toMatch(
      /device\s+HouseholdDevice\?\s+@relation\([^\n]+onDelete: SetNull\)/,
    );
    expect(schema).toContain(
      'activities Activity[] @relation("ActivitySubjectMember")',
    );
    expect(schema).toContain(
      'device_audit_events DeviceAuditEvent[] @relation("DeviceAuditSubjectMember")',
    );
  });

  it("keeps the migration and fresh-start DDL idempotent and non-cascading", () => {
    const migration = fs.readFileSync(
      path.join(
        ROOT,
        "database/migration-zz-household-member-audit-subjects.sql",
      ),
      "utf8",
    );
    const fresh = fs.readFileSync(
      path.join(ROOT, "scripts/migrate.js"),
      "utf8",
    );
    expect(fresh).toContain('"subject_member_id" TEXT');
    expect(fresh).toContain(
      '"subject_member_erased" BOOLEAN NOT NULL DEFAULT false',
    );
    expect(fresh).not.toContain("subject_member_fkey");
    expect(fresh).not.toContain("subject_member_erased_check");
    expect(fresh).not.toContain("family_id_subject_member_id_idx");
    expect(migration).toContain("FROM pg_attribute");
    expect(migration).toContain("FROM pg_constraint");
    expect(migration).toContain("FROM pg_class c");
    expect(migration).toContain("JOIN pg_index i");
    expect(migration).toContain("actual_default IS DISTINCT FROM 'false'");
    expect(migration).toContain("actual_default IS NOT NULL");
    expect(
      "CHECK ((NOT subject_member_erased) OR (subject_member_id IS NULL))"
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, ""),
    ).toBe("checknotsubject_member_erasedorsubject_member_idisnull");
    expect(migration).toContain(
      "normalized_definition <> 'checknotsubject_member_erasedorsubject_member_idisnull'",
    );
    expect(migration).toContain("ON DELETE NO ACTION ON UPDATE NO ACTION");
    expect(migration).toContain(
      "ARRAY[member_attnum, family_attnum]::SMALLINT[]",
    );
    expect(migration).toContain(
      "ARRAY[family_attnum, subject_attnum]::int2vector",
    );
    expect(migration).not.toMatch(
      /ALTER TABLE[\s\S]*?ADD COLUMN IF NOT EXISTS/,
    );
    expect(migration).toContain(
      "CREATE INDEX %I ON %I (family_id, subject_member_id)",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION guard_audit_member_subject()",
    );
    expect(migration).toContain(
      "DROP TRIGGER IF EXISTS activity_member_subject_guard",
    );
    expect(migration).toContain(
      "DROP TRIGGER IF EXISTS device_audit_event_member_subject_guard",
    );
    for (const failure of [
      "must be nullable text without a default",
      "has an incompatible subject foreign key",
      "has an incompatible erased-subject check",
      "has an incompatible subject index",
    ]) {
      expect(migration).toContain(failure);
    }
    expect(migration).toContain(
      "OLD.subject_member_erased AND NOT NEW.subject_member_erased",
    );
    expect(migration).toContain("OLD.subject_member_id IS NOT NULL");
    expect(migration).toMatch(/BEGIN;[\s\S]*COMMIT;/);

    const accountDeletion = fs.readFileSync(
      path.join(ROOT, "src/lib/account-deletion.ts"),
      "utf8",
    );
    expect(
      accountDeletion.indexOf("why: 'activity feed and member subjects'"),
    ).toBeGreaterThan(accountDeletion.indexOf("why: 'projects'"));
    expect(
      accountDeletion.indexOf("why: 'activity feed and member subjects'"),
    ).toBeLessThan(accountDeletion.indexOf("why: 'chores'"));
    expect(accountDeletion.indexOf("why: 'device audit history'")).toBeLessThan(
      accountDeletion.indexOf(
        "why: 'household person profiles after their subject history (#480)'",
      ),
    );
  });

  it("redacts member subjects before profile deletion while preserving actors", async () => {
    const calls: string[] = [];
    const tx = {
      householdMemberLegacyMapping: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { member_id: "member-current", family_id: "family-current" },
          ]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest
          .fn()
          .mockImplementation(async () => calls.push("legacy.delete")),
      },
      householdMemberAccountLink: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest
          .fn()
          .mockImplementation(async () => calls.push("link.delete")),
      },
      householdMember: {
        findMany: jest
          .fn()
          .mockImplementation(
            ({ where }: { where: Record<string, unknown> }) =>
              "erasure_user_id" in where
                ? [{ id: "member-old", family_id: "family-old" }]
                : [{ id: "member-current", erasure_user_id: null }],
          ),
        deleteMany: jest
          .fn()
          .mockImplementation(async () => calls.push("member.delete")),
      },
      activity: {
        updateMany: jest
          .fn()
          .mockImplementation(async () => calls.push("activity.redact")),
      },
      deviceAuditEvent: {
        updateMany: jest
          .fn()
          .mockImplementation(async () => calls.push("device.redact")),
      },
      choreAssignment: {
        updateMany: jest
          .fn()
          .mockImplementation(async () => calls.push("assignment.redact")),
      },
      chore: {
        updateMany: jest
          .fn()
          .mockImplementation(async () => calls.push("chore.redact")),
      },
    };

    await eraseAccountProfilesInTx(tx, "user-current", "family-current");

    expect(tx.activity.updateMany).toHaveBeenCalledWith({
      where: {
        family_id: "family-current",
        subject_member_id: { in: ["member-current"] },
      },
      data: { subject_member_id: null, subject_member_erased: true },
    });
    expect(tx.deviceAuditEvent.updateMany).toHaveBeenCalledWith({
      where: {
        family_id: "family-current",
        subject_member_id: { in: ["member-current"] },
      },
      data: { subject_member_id: null, subject_member_erased: true },
    });
    expect(tx.activity.updateMany).toHaveBeenCalledWith({
      where: {
        family_id: "family-old",
        subject_member_id: { in: ["member-old"] },
      },
      data: { subject_member_id: null, subject_member_erased: true },
    });
    expect(tx.deviceAuditEvent.updateMany).toHaveBeenCalledWith({
      where: {
        family_id: "family-old",
        subject_member_id: { in: ["member-old"] },
      },
      data: { subject_member_id: null, subject_member_erased: true },
    });
    expect(tx.activity.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      "user_id",
    );
    expect(
      tx.deviceAuditEvent.updateMany.mock.calls[0][0].data,
    ).not.toHaveProperty("actor_user_id");
    expect(calls.indexOf("activity.redact")).toBeLessThan(
      calls.indexOf("member.delete"),
    );
    expect(calls.indexOf("device.redact")).toBeLessThan(
      calls.indexOf("member.delete"),
    );
  });
});
