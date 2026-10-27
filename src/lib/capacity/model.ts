/** Fabricated workload construction only. No fixtures, database or HTTP effects. */
export const CAPACITY_MODEL_VERSION = "herewoven.capacity.v1";
export const CAPACITY_SCENARIOS = [
  { name: "today", weight: 30 },
  { name: "calendar", weight: 15 },
  { name: "groceries", weight: 20 },
  { name: "inventory", weight: 10 },
  { name: "chores", weight: 10 },
  { name: "identity", weight: 5 },
  { name: "ai", weight: 5 },
  { name: "notifications", weight: 5 },
] as const;
export type CapacityScenario = typeof CAPACITY_SCENARIOS[number]["name"];
export type CapacityProfile = "ordinary" | "calendar" | "food" | "history";
export type CapacityRole = "parent" | "teen" | "child";
export const CAPACITY_STAGES = {
  reference: { households: 2, sessions: 1, warmupMs: 60_000, measuredMs: 180_000 },
  beta: { households: 5, sessions: 10, warmupMs: 120_000, measuredMs: 600_000 },
  contention: { households: 20, sessions: 50, warmupMs: 120_000, measuredMs: 600_000 },
  ceiling: { households: 50, sessions: 100, warmupMs: 120_000, measuredMs: 600_000 },
} as const;
export type CapacityStage = keyof typeof CAPACITY_STAGES;

/** Stable 32-bit generator; each worker gets its own stream to avoid async interleaving drift. */
export function capacityRandom(seed: string): () => number {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.codePointAt(0)!;
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export function capacityScenario(random: () => number): CapacityScenario {
  let remaining = random() * 100;
  for (const scenario of CAPACITY_SCENARIOS) {
    remaining -= scenario.weight;
    if (remaining < 0) return scenario.name;
  }
  return "notifications";
}

export function capacityPlan(input: {
  stage: CapacityStage;
  /** Small stages must run all four profiles separately instead of rounding away skews. */
  profile?: CapacityProfile;
  hotHouseholds?: boolean;
}) {
  const stage = CAPACITY_STAGES[input.stage];
  if (!stage) throw new Error("Unknown capacity stage");
  const profiles: CapacityProfile[] = ["ordinary", "calendar", "food", "history"];
  if (input.profile !== undefined && !profiles.includes(input.profile))
    throw new Error("Unknown capacity profile");
  if (stage.households < 10 && input.profile === undefined)
    throw new Error("Small capacity stages require an explicit profile");
  const households = Array.from({ length: stage.households }, (_, index) => ({
    // Ordinals only, never production IDs; adapters map these to isolated fixtures.
    ordinal: index,
    profile: input.profile ?? (index < stage.households * 0.7 ? "ordinary"
      : profiles[1 + Math.floor((index - stage.households * 0.7) / (stage.households * 0.1))]),
  }));
  return {
    version: CAPACITY_MODEL_VERSION,
    stage: input.stage,
    ...stage,
    hotHouseholds: input.hotHouseholds === true,
    trafficHouseholds: households,
    // Sentinels never enter the random traffic pool.
    sentinelOrdinals: [stage.households, stage.households + 1],
  };
}
export type CapacityPlan = ReturnType<typeof capacityPlan>;

/** A worker slot is not a persistent signed-in client. Adapters resolve exact owned actors. */
export function capacityIntents(plan: CapacityPlan, worker: number) {
  if (!Number.isSafeInteger(worker) || worker < 0 || worker >= plan.sessions)
    throw new Error("Unknown capacity worker");
  const random = capacityRandom(`${plan.version}:${plan.stage}:${worker}`);
  let sequence = 0;
  return () => {
    const scenario = capacityScenario(random);
    const hotCount = Math.max(1, Math.floor(plan.households / 10));
    const householdOrdinal = !plan.hotHouseholds
      ? Math.floor(random() * plan.households)
      : random() < 0.5 ? Math.floor(random() * hotCount)
        : hotCount + Math.floor(random() * (plan.households - hotCount));
    const shared = (scenario === "today" || scenario === "groceries") && random() < 0.2;
    const roleDraw = random();
    const role: CapacityRole = roleDraw < 0.6 ? "parent" : roleDraw < 0.85 ? "teen" : "child";
    return {
      scenario, householdOrdinal, role, shared,
      worker, sequence: sequence++,
      thinkMs: 2000 + Math.floor(random() * 3001),
    };
  };
}
export type CapacityIntent = ReturnType<ReturnType<typeof capacityIntents>>;
