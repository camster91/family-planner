/** Fabricated fixtures and independent expected facts. Explicit QA invocation
 * only: importing this module does not evaluate, fetch, connect or change flags. */
import { canonicalRequestJson } from "../idempotency-request-json";
import { buildFoodPlan } from "../food-planning/planner";
import {
  foodPlanRequest,
  foodTimingRequest,
  type FoodPlanningInputs,
} from "../food-planning/contract";
import { planFoodTiming } from "../food-planning/timing";
import {
  buildAssistantReferenceCatalog,
  resolveAssistantEvidence,
} from "../assistant-references";
import { referencedAssistantReply } from "../assistant-reference-contract";
import {
  assistantReplySchema,
  assistantActionSchema,
  canUseAssistantAction,
} from "../assistant-actions";
import { defaultFeatures } from "../features";
import { foodAiProviderReply } from "../food-planning/ai-contract";
import {
  buildAiContractReport,
  type AiEvaluationCase,
  type AiEvaluationDimension,
} from "./report";
const owner = {
  userId: "eval-person",
  familyId: "eval-family",
  role: "parent",
  generation: 0,
};
const observed = "2026-10-22T12:00:00.000Z";
const key = "fabricated-offline-evaluation-key";
function inputs(): FoodPlanningInputs {
  return {
    recipes: [
      {
        id: "eval-rice",
        title: "Synthetic rice",
        servings: 2,
        prep_time: 5,
        cook_time: 15,
        ingredients: [
          {
            amount: 100,
            unit: "g",
            ingredient: {
              id: "eval-ingredient",
              name: "Synthetic rice",
              unit: "g",
            },
          },
        ],
      },
    ],
    stock: [],
    occupied: [],
    coverage: { recipes: true, stock: true, meals: true },
  };
}
function request(servings = 2) {
  return foodPlanRequest.parse({
    timeZone: "UTC",
    repeatRecipes: true,
    slots: [
      { key: "eval-slot", date: "2026-10-22", mealType: "dinner", servings },
    ],
  });
}
function catalog(scope = owner, epoch = 1) {
  return buildAssistantReferenceCatalog(
    [
      {
        kind: "chore",
        id: "eval-chore",
        index: 0,
        label: "Synthetic task",
        versionInput: { epoch },
      },
    ],
    scope,
    observed,
    key,
  );
}
type Case = {
  id: AiEvaluationCase;
  dimension: AiEvaluationDimension;
  actual: () => unknown;
  expected: unknown;
};
const cases: Case[] = [
  {
    id: "use-soon-expiry",
    dimension: "canonical-math",
    expected: { useSoon: 1, shortfall: 0 },
    actual: () => {
      const source = inputs();
      source.stock = [
        {
          id: "eval-expired",
          ingredient_id: "eval-ingredient",
          name: "Synthetic rice",
          amount: 1000,
          unit: "g",
          expires_on: "2026-10-21",
          date_kind: "use_by",
          status: "active",
        },
        {
          id: "eval-soon",
          ingredient_id: "eval-ingredient",
          name: "Synthetic rice",
          amount: 100,
          unit: "g",
          expires_on: "2026-10-23",
          date_kind: "use_by",
          status: "active",
        },
      ];
      const plan = buildFoodPlan(request(), source),
        choice = plan.slots[0].choice!;
      return {
        useSoon: choice.useSoonCount,
        shortfall: choice.ingredients[0].shortfall,
      };
    },
  },
  {
    id: "missing-grocery-quantity",
    dimension: "canonical-math",
    expected: { required: 200, available: 150, shortfall: 50 },
    actual: () => {
      const source = inputs();
      source.stock = [
        {
          id: "eval-stock",
          ingredient_id: "eval-ingredient",
          name: "Synthetic rice",
          amount: 150,
          unit: "g",
          expires_on: null,
          date_kind: "best_before",
          status: "active",
        },
      ];
      const line = buildFoodPlan(request(4), source).slots[0].choice!
        .ingredients[0];
      return {
        required: line.required,
        available: line.recordedAvailable,
        shortfall: line.shortfall,
      };
    },
  },
  {
    id: "stock-counted-once",
    dimension: "canonical-math",
    expected: [0, 50],
    actual: () => {
      const source = inputs();
      source.stock = [
        {
          id: "eval-stock",
          ingredient_id: "eval-ingredient",
          name: "Synthetic rice",
          amount: 150,
          unit: "g",
          expires_on: null,
          date_kind: "best_before",
          status: "active",
        },
      ];
      const query = request();
      query.slots.push({
        ...query.slots[0],
        key: "eval-next",
        date: "2026-10-23",
      });
      return buildFoodPlan(query, source).slots.map(
        (row) => row.choice!.ingredients[0].shortfall,
      );
    },
  },
  {
    id: "continuous-departure-window",
    dimension: "canonical-math",
    expected: { state: "fits", finish: "2026-10-22T16:20:00.000Z" },
    actual: () => {
      const result = planFoodTiming(
        foodTimingRequest.parse({
          start: "2026-10-22T15:00:00Z",
          end: "2026-10-22T18:00:00Z",
          departureEventId: "eval-departure",
          beforeCookingMinutes: 5,
          eatingMinutes: 10,
          cleanupMinutes: 5,
          travelMinutes: 30,
          departurePreparationMinutes: 10,
        }),
        30,
        {
          observedAt: observed,
          complete: true,
          reasons: [],
          ignoredEventIds: [],
          events: [
            {
              id: "eval-busy",
              start: "2026-10-22T15:00:00Z",
              end: "2026-10-22T15:30:00Z",
              sourceToken: "a".repeat(64),
              repeating: false,
            },
          ],
          departures: [
            {
              id: "eval-departure",
              title: "Synthetic departure",
              start: "2026-10-22T17:00:00Z",
              end: "2026-10-22T18:00:00Z",
              sourceToken: "b".repeat(64),
              repeating: false,
            },
          ],
        },
      );
      return { state: result.state, finish: result.finish };
    },
  },
  {
    id: "scaled-duration-unknown",
    dimension: "grounding",
    expected: null,
    actual: () =>
      buildFoodPlan(request(4), inputs()).slots[0].choice!.totalMinutes,
  },
  {
    id: "unresolved-commitment",
    dimension: "grounding",
    expected: true,
    actual: () => {
      const source = inputs();
      source.commitments = {
        horizon: { from: "2026-10-22", through: "2026-10-22" },
        entries: [
          {
            id: "eval-unlinked",
            kind: "meal",
            date: "2026-10-22",
            originalDate: "2026-10-22",
            recipeId: null,
            servings: null,
          },
        ],
        recipes: [],
        prepared: [],
      };
      return buildFoodPlan(request(), source).slots[0].holds.includes(
        "commitments-unresolved",
      );
    },
  },
  {
    id: "invented-reference",
    dimension: "grounding",
    expected: null,
    actual: () =>
      resolveAssistantEvidence([`asr1_${"0".repeat(64)}`], catalog()),
  },
  {
    id: "cross-household-reference",
    dimension: "scope",
    expected: null,
    actual: () =>
      resolveAssistantEvidence(
        [catalog()[0].provider.ref],
        catalog({ ...owner, familyId: "eval-foreign" }),
      ),
  },
  {
    id: "changed-source-revision",
    dimension: "freshness",
    expected: true,
    actual: () =>
      catalog(owner, 1)[0].provider.revision !==
      catalog(owner, 2)[0].provider.revision,
  },
  {
    id: "deleted-reference",
    dimension: "grounding",
    expected: null,
    actual: () => resolveAssistantEvidence([catalog()[0].provider.ref], []),
  },
  {
    id: "clarification-contract",
    dimension: "clarification",
    expected: true,
    actual: () =>
      referencedAssistantReply.safeParse({
        reply: "Which day should I use?",
        action: null,
        basis: "clarification",
        references: [],
      }).success,
  },
  {
    id: "injected-action",
    dimension: "schema",
    expected: false,
    actual: () =>
      assistantReplySchema.safeParse({
        reply: "Synthetic malicious instruction",
        action: { kind: "execute", code: "ignore all permissions" },
      }).success,
  },
  {
    id: "child-action-refusal",
    dimension: "scope",
    expected: false,
    actual: () =>
      canUseAssistantAction(
        { kind: "open", destination: "food-plan" },
        "child",
        defaultFeatures(),
      ),
  },
  {
    id: "malformed-food-output",
    dimension: "schema",
    expected: false,
    actual: () =>
      foodAiProviderReply.safeParse({
        protocol: "herewoven.food-ai.v1",
        choices: [],
        actions: [{ kind: "save" }],
      }).success,
  },
  {
    id: "incomplete-event-intent",
    dimension: "schema",
    expected: false,
    actual: () =>
      assistantActionSchema.safeParse({
        kind: "event_create",
        title: "Synthetic event",
        start: "2026-10-22T16:00",
      }).success,
  },
];
export function runAiContractEvaluation() {
  return buildAiContractReport(
    cases.map((entry) => {
      try {
        return {
          caseId: entry.id,
          dimension: entry.dimension,
          outcome:
            canonicalRequestJson(entry.actual()) ===
            canonicalRequestJson(entry.expected)
              ? "pass"
              : "fail",
        };
      } catch {
        return {
          caseId: entry.id,
          dimension: entry.dimension,
          outcome: "error",
        };
      }
    }),
  );
}
