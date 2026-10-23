/** Authored/unrun: structural grounding, not a semantic accuracy score. */
import {
  buildAssistantReferenceCatalog,
  resolveAssistantEvidence,
  type AssistantSourceRow,
} from "../assistant-references";
import {
  referencedAssistantReply,
  assistantResponseSchema,
} from "../assistant-reference-contract";
const owner = {
  userId: "person-a",
  familyId: "family-a",
  role: "parent",
  generation: 3,
};
const now = "2026-10-22T12:00:00.000Z";
const key = "fabricated-reference-test-key";
const rows: AssistantSourceRow[] = [
  {
    kind: "chore",
    id: "task-a",
    index: 0,
    label: "Pack bag",
    versionInput: { epoch: 1 },
  },
];
it("keeps references stable within exact owner scope while versions change with canonical source state", () => {
  const first = buildAssistantReferenceCatalog(rows, owner, now, key);
  expect(
    buildAssistantReferenceCatalog(
      rows,
      {
        generation: 3,
        role: "parent",
        familyId: "family-a",
        userId: "person-a",
      },
      now,
      key,
    ),
  ).toEqual(first);
  const changed = buildAssistantReferenceCatalog(
    [{ ...rows[0], versionInput: { epoch: 2 } }],
    owner,
    now,
    key,
  );
  expect(changed[0].provider.ref).toBe(first[0].provider.ref);
  expect(changed[0].provider.revision).not.toBe(first[0].provider.revision);
  expect(JSON.stringify(first.map((entry) => entry.provider))).not.toMatch(
    /task-a|family-a|person-a|Pack bag|dashboard/,
  );
});
it.each([
  { ...owner, familyId: "family-b" },
  { ...owner, userId: "person-b" },
  { ...owner, generation: 4 },
  { ...owner, role: "teen" },
])(
  "prevents reference reuse across owner/household/role/generation changes",
  (scope) => {
    const first = buildAssistantReferenceCatalog(rows, owner, now, key);
    const other = buildAssistantReferenceCatalog(rows, scope, now, key);
    expect(other[0].provider.ref).not.toBe(first[0].provider.ref);
    expect(resolveAssistantEvidence([first[0].provider.ref], other)).toBeNull();
  },
);
it("uses only server-built canonical destinations and rejects unknown or duplicate citations", () => {
  const catalog = buildAssistantReferenceCatalog(rows, owner, now, key);
  const ref = catalog[0].provider.ref;
  expect(resolveAssistantEvidence([ref], catalog)).toEqual([
    expect.objectContaining({
      label: "Pack bag",
      href: "/dashboard/chores/edit?id=task-a",
      observedAt: now,
    }),
  ]);
  expect(
    resolveAssistantEvidence([`asr1_${"0".repeat(64)}`], catalog),
  ).toBeNull();
  expect(resolveAssistantEvidence([ref, ref], catalog)).toBeNull();
  expect(
    assistantResponseSchema.safeParse({
      reply: "Review",
      action: null,
      evidence: [{ ...catalog[0].evidence, href: "https://example.invalid" }],
    }).success,
  ).toBe(false);
});
it("requires an explicit evidence basis and refuses supplied labels, URLs and malformed record identities", () => {
  const catalog = buildAssistantReferenceCatalog(rows, owner, now, key);
  const ref = catalog[0].provider.ref;
  expect(
    referencedAssistantReply.safeParse({
      reply: "Pack bag is on Today",
      action: null,
      basis: "context",
      references: [ref],
    }).success,
  ).toBe(true);
  for (const value of [
    {
      reply: "A household claim",
      action: null,
      basis: "context",
      references: [],
    },
    {
      reply: "Please clarify",
      action: null,
      basis: "clarification",
      references: [ref],
    },
    {
      reply: "A household claim",
      action: null,
      basis: "context",
      references: [ref],
      href: "/dashboard/settings",
    },
  ])
    expect(referencedAssistantReply.safeParse(value).success).toBe(false);
  expect(() =>
    buildAssistantReferenceCatalog(
      [{ ...rows[0], id: "../foreign" }],
      owner,
      now,
      key,
    ),
  ).toThrow();
  expect(() =>
    buildAssistantReferenceCatalog([rows[0], rows[0]], owner, now, key),
  ).toThrow();
});
