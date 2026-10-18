import {
  assistantReplySchema,
  canUseAssistantAction,
  assistantDestination,
  assistantPrompt,
  type AssistantDestination,
} from "../assistant-actions";
import { defaultFeatures, FEATURES, type FamilyFeatures } from "../features";
import {
  assistantDestinationLabels,
  assistantEnglish,
  assistantSpanish,
} from "@/i18n/assistant";

function allFeaturesOn(): FamilyFeatures {
  return Object.fromEntries(
    FEATURES.map(({ key }) => [key, true]),
  ) as FamilyFeatures;
}
it("rejects arbitrary URLs, code tools and record ids from AI", () => {
  expect(
    assistantReplySchema.safeParse({
      reply: "Done",
      action: { kind: "open", destination: "https://evil.test" },
    }).success,
  ).toBe(false);
  expect(
    assistantReplySchema.safeParse({
      reply: "Done",
      action: { kind: "list_delete", title: "Food", id: "foreign" },
    }).success,
  ).toBe(false);
  expect(
    assistantReplySchema.safeParse({
      reply: "Done",
      action: { kind: "execute", code: "fetch(...)" },
    }).success,
  ).toBe(false);
});
it("parent/teen create while deletion remains parent-only, and children cannot spend provider budget", () => {
  const f = defaultFeatures(),
    a = { kind: "list_delete", title: "Food" } as const;
  expect(canUseAssistantAction(a, "parent", f)).toBe(true);
  expect(canUseAssistantAction(a, "teen", f)).toBe(false);
  expect(
    canUseAssistantAction(
      { kind: "event_create", title: "Test", start: "a", end: "b" },
      "teen",
      f,
    ),
  ).toBe(true);
  expect(
    canUseAssistantAction({ kind: "grocery_add", title: "Milk" }, "child", f),
  ).toBe(false);
});
it("gates disabled domains and parent destinations", () => {
  const f = defaultFeatures();
  expect(
    canUseAssistantAction(
      { kind: "note_create", title: "Test", body: "Hi" },
      "parent",
      f,
    ),
  ).toBe(false);
  expect(
    canUseAssistantAction({ kind: "open", destination: "features" }, "teen", f),
  ).toBe(false);
  expect(assistantDestination("recipes")).toBe("/dashboard/meals/explore");
});
it("maps every canonical feature to a fixed safe destination and gates it", () => {
  const allOn = allFeaturesOn();

  for (const feature of FEATURES) {
    const action = {
      kind: "open",
      destination: feature.key as AssistantDestination,
    } as const;

    expect(
      assistantReplySchema.safeParse({ reply: "Open it", action }).success,
    ).toBe(true);
    expect(assistantDestination(feature.key)).toBe(feature.href);
    expect(canUseAssistantAction(action, "parent", allOn)).toBe(true);
    expect(
      canUseAssistantAction(action, "parent", {
        ...allOn,
        [feature.key]: false,
      }),
    ).toBe(false);
  }

  const teenAllowed = new Set([
    "calendar",
    "lists",
    "meals",
    "notes",
    "anniversaries",
    "inventory",
    "wishlist",
    "emergency",
    "allowance",
    "handoff",
    "sick-days",
    "pickups",
  ]);
  for (const feature of FEATURES) {
    const action = {
      kind: "open",
      destination: feature.key as AssistantDestination,
    } as const;
    expect(canUseAssistantAction(action, "teen", allOn)).toBe(
      teenAllowed.has(feature.key),
    );
    expect(canUseAssistantAction(action, "child", allOn)).toBe(false);
  }

  expect(Object.keys(assistantDestinationLabels.es).sort()).toEqual(
    Object.keys(assistantDestinationLabels.en).sort(),
  );
  for (const destination of Object.keys(
    assistantDestinationLabels.en,
  ) as AssistantDestination[]) {
    expect(assistantDestinationLabels.en[destination]).not.toBe("");
    expect(assistantDestinationLabels.es[destination]).not.toBe("");
  }
  expect(assistantDestinationLabels.en["sick-days"]).toBe("Sick days & meds");
  expect(assistantDestinationLabels.es["sick-days"]).toBe(
    "Días de enfermedad y medicinas",
  );
});
it("parses and localizes analytics navigation while enforcing role and dependency gates", () => {
  const allOn = {
    ...defaultFeatures(),
    gamification: true,
    analytics: true,
    notes: true,
    inventory: true,
  };
  const action = { kind: "open", destination: "analytics" } as const;

  expect(
    assistantReplySchema.safeParse({ reply: "Open it", action }).success,
  ).toBe(true);
  expect(assistantDestination("analytics")).toBe("/dashboard/analytics");
  expect(canUseAssistantAction(action, "parent", allOn)).toBe(true);
  expect(canUseAssistantAction(action, "teen", allOn)).toBe(false);
  expect(canUseAssistantAction(action, "child", allOn)).toBe(false);
  expect(
    canUseAssistantAction(action, "parent", { ...allOn, gamification: false }),
  ).toBe(false);
  expect(
    canUseAssistantAction(action, "parent", { ...allOn, analytics: false }),
  ).toBe(false);
  const gamificationAction = {
    kind: "open",
    destination: "gamification",
  } as const;
  const gamificationOnly = { ...allOn, analytics: false };
  expect(
    canUseAssistantAction(gamificationAction, "parent", gamificationOnly),
  ).toBe(false);
  const gamificationOnlyCatalog = assistantPrompt("parent", gamificationOnly);
  const openCatalog =
    gamificationOnlyCatalog.match(
      /\{"kind":"open","destination":"([^"]+)"\}/,
    )?.[1] ?? "";
  expect(openCatalog.split("|")).not.toContain("gamification");
  expect(assistantEnglish.analytics).toBe("Analytics");
  expect(assistantSpanish.analytics).toBe("Análisis");
  expect(
    assistantReplySchema.safeParse({
      reply: "Open it",
      action: { kind: "open", destination: "Analytics" },
    }).success,
  ).toBe(false);
});
it("keeps the model's feature map and open catalog truthful for role and dependencies", () => {
  const allOn = {
    ...defaultFeatures(),
    gamification: true,
    analytics: true,
    notes: true,
    inventory: true,
  };
  const parentWithDependencyOff = assistantPrompt("parent", {
    ...allOn,
    gamification: false,
  });
  expect(parentWithDependencyOff).toContain('"gamification":false');
  expect(parentWithDependencyOff).toContain('"analytics":false');
  expect(parentWithDependencyOff).not.toContain('"analytics|');
  expect(parentWithDependencyOff).not.toContain('|analytics"');

  const parentWithDependencyOn = assistantPrompt("parent", allOn);
  expect(parentWithDependencyOn).toContain('"analytics"');
  expect(parentWithDependencyOn).toContain('"analytics":true');

  const teenCatalog = assistantPrompt("teen", allOn);
  expect(teenCatalog).toContain(
    '"destination":"today|calendar|lists|meals|settings|notes|inventory|emergency|recipes"',
  );
  expect(teenCatalog).not.toContain('"analytics|');
  expect(teenCatalog).not.toContain('|analytics"');
  expect(teenCatalog).not.toContain("features");

  const childCatalog = assistantPrompt("child", allOn);
  expect(childCatalog).toContain(
    "No open action is available for this role or enabled features.",
  );
  expect(childCatalog).not.toContain('"kind":"open"');
});
