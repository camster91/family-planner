/** Dormant load engine. No HTTP, database, provider, CLI or import-time activation. */
import { assertFixtureTargetAllowed } from "../fixtures/guard";
import { assertLocalPerfTarget, percentile } from "../perf-target";
import { capacityIntents, CAPACITY_SCENARIOS, CAPACITY_STAGES, CAPACITY_MODEL_VERSION, type CapacityIntent, type CapacityPlan, type CapacityScenario } from "./model";

type Outcome = "confirmed" | "refused" | "unknown" | "failed" | "unsafe";
export type CapacityResult = { outcome: Outcome; requests: number; responseBytes: number };
type Phase = "warmup" | "measured";
type StopReason = "finished" | "cancelled" | "scenario-timeout" | "unsafe" | "adapter-failure" | "error-rate" | "resource-limit" | "reconciliation";
export type CapacityAdapter = (context: {
  intent: CapacityIntent; phase: Phase; signal: AbortSignal;
  /** Every adapter must bound each canonical request, including its body. */
  requestDeadlineMs: 15000;
}) => Promise<CapacityResult>;
export type CapacityAdapters = Record<CapacityScenario, CapacityAdapter>;

const safeCount = (number: unknown): number is number =>
  typeof number === "number" && Number.isSafeInteger(number) && number >= 0;
function validResult(value: CapacityResult): boolean {
  return value !== null && typeof value === "object" &&
    ["confirmed", "refused", "unknown", "failed", "unsafe"].includes(value.outcome) &&
    safeCount(value.requests) && safeCount(value.responseBytes);
}

/**
 * Requires canonical adapters and before/after reconciliation. Missing adapters
 * refuse before work; synthetic placeholder success is not a supported fallback.
 * A timed-out adapter may ignore abort: stop the entire stage, never reuse its slot.
 */
export async function runCapacityStage(input: {
  plan: CapacityPlan;
  sourceCommit: string;
  adapters: CapacityAdapters;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  reconcile: (phase: "before" | "after", signal: AbortSignal) => Promise<boolean>;
  resourceLimitReached: (signal: AbortSignal) => Promise<boolean>;
}) {
  const plan = { ...input.plan,
    trafficHouseholds: input.plan.trafficHouseholds.map(row => ({ ...row })),
    sentinelOrdinals: [...input.plan.sentinelOrdinals],
  };
  const adapters = { ...input.adapters };
  const env = { ...(input.env ?? process.env) };
  const sourceCommit = input.sourceCommit;
  const reconcile = input.reconcile;
  const resourceLimitReached = input.resourceLimitReached;
  const externalSignal = input.signal;
  if (env.CAPACITY_ALLOW !== "local-fabricated-v1") throw new Error("Capacity adoption required");
  assertLocalPerfTarget(env.PERF_BASE_URL, env);
  assertFixtureTargetAllowed(env);
  if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Exact source identity required");
  const configured = CAPACITY_STAGES[plan.stage];
  if (!configured || plan.version !== CAPACITY_MODEL_VERSION ||
    plan.sessions !== configured.sessions || plan.households !== configured.households ||
    plan.warmupMs !== configured.warmupMs || plan.measuredMs !== configured.measuredMs)
    throw new Error("Capacity stage limits cannot be overridden");
  if (CAPACITY_SCENARIOS.some(({ name }) => typeof adapters[name] !== "function"))
    throw new Error("All canonical capacity adapters are required");
  const controller = new AbortController();
  let reason: StopReason = "finished";
  const stop = (why: StopReason) => {
    if (why === "unsafe") reason = why;
    if (!controller.signal.aborted) { reason = why; controller.abort(); }
  };
  const externalStop = () => stop("cancelled");
  externalSignal?.addEventListener("abort", externalStop, { once: true });
  if (externalSignal?.aborted) externalStop();
  const rows = Object.fromEntries(CAPACITY_SCENARIOS.map(({ name }) => [name, {
    started: 0, confirmed: 0, refused: 0, unknown: 0, failed: 0, unsafe: 0,
    requests: 0, responseBytes: 0, samples: [] as number[],
  }])) as Record<CapacityScenario, {
    started: number; confirmed: number; refused: number; unknown: number; failed: number; unsafe: number;
    requests: number; responseBytes: number; samples: number[];
  }>;
  let maxInFlight = 0, inFlight = 0, warmupStarted = 0, measuredStarted = 0;
  let measuredElapsedMs = 0;
  let reconciledBefore = false, reconciledAfter = false;
  const counts = { parent: 0, teen: 0, child: 0, shared: 0 };
  // Fixed-size recent window; no URLs, payloads, IDs, exception messages or credentials.
  const recent: { at: number; failed: boolean }[] = [];
  const boundary = async <T>(work: () => Promise<T>, ms: number, onTimeout: StopReason): Promise<T | undefined> => {
    if (controller.signal.aborted) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    const stopped = new Promise<undefined>((resolve) => {
      abort = () => resolve(undefined);
      controller.signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => stop(onTimeout), ms);
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => controller.signal.aborted ? undefined : work())
          .catch(() => { stop("adapter-failure"); return undefined; }),
        stopped,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (abort) controller.signal.removeEventListener("abort", abort);
    }
  };
  const pause = (ms: number) => new Promise<void>((resolve) => {
    if (controller.signal.aborted) { resolve(); return; }
    const abort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => {
      controller.signal.removeEventListener("abort", abort); resolve();
    }, ms);
    controller.signal.addEventListener("abort", abort, { once: true });
  });
  const streams = Array.from({ length: plan.sessions }, (_, worker) => capacityIntents(plan, worker));
  try {
    reconciledBefore = await boundary(() => reconcile("before", controller.signal), 60_000, "reconciliation") === true;
    if (!reconciledBefore) stop("reconciliation");
    for (const phase of ["warmup", "measured"] as const) {
      if (controller.signal.aborted) break;
      const began = performance.now();
      const duration = phase === "warmup" ? plan.warmupMs : plan.measuredMs;
      await Promise.all(Array.from({ length: plan.sessions }, (_, worker) => (async () => {
        const next = streams[worker];
        while (!controller.signal.aborted && performance.now() - began < duration) {
          const limited = await boundary(() => resourceLimitReached(controller.signal), 15_000, "resource-limit");
          if (limited !== false) { stop("resource-limit"); break; }
          const intent = next();
          if (phase === "measured" && rows[intent.scenario].started >= 100_000) {
            stop("resource-limit"); break;
          }
          const started = performance.now();
          inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
          if (phase === "warmup") warmupStarted++;
          else { rows[intent.scenario].started++; measuredStarted++; counts[intent.shared ? "shared" : intent.role]++; }
          const result = await boundary(() => adapters[intent.scenario]({
            intent, phase, signal: controller.signal, requestDeadlineMs: 15000,
          }), 60_000, "scenario-timeout");
          inFlight--;
          if (phase === "measured") {
            const row = rows[intent.scenario];
            const valid = result !== undefined && validResult(result);
            const outcome = valid ? result.outcome : "unknown";
            row[outcome]++;
            if (valid) { row.requests += result.requests; row.responseBytes += result.responseBytes; }
            // Starts are capped before dispatch, so every started result fits.
            row.samples.push(performance.now() - started);
            const now = performance.now();
            recent.push({ at: now, failed: outcome === "failed" || outcome === "unknown" });
            while (recent.length && recent[0].at < now - 60_000) recent.shift();
            if (now - began >= 60_000 && recent.filter(item => item.failed).length / recent.length > 0.01)
              stop("error-rate");
          }
          if (result === undefined) break;
          if (!validResult(result)) { stop("adapter-failure"); break; }
          if (result.outcome === "unsafe") { stop("unsafe"); break; }
          await pause(Math.min(intent.thinkMs, Math.max(0, duration - (performance.now() - began))));
        }
      })()));
      if (phase === "measured") measuredElapsedMs = performance.now() - began;
    }
    // An abort-ignoring timed-out adapter can still be running. Never reconcile
    // concurrently with that unknown work or claim the final database is stable.
    if (!controller.signal.aborted) {
      reconciledAfter = await boundary(() => reconcile("after", controller.signal), 60_000, "reconciliation") === true;
      if (!reconciledAfter) stop("reconciliation");
    }
  } finally {
    externalSignal?.removeEventListener("abort", externalStop);
  }
  const timings = Object.fromEntries(CAPACITY_SCENARIOS.map(({ name }) => {
    const { samples, ...counts } = rows[name];
    return [name, { ...counts,
      p50Ms: samples.length ? percentile(samples, 50) : null,
      p95Ms: samples.length ? percentile(samples, 95) : null,
      p99Ms: samples.length ? percentile(samples, 99) : null,
      maxMs: samples.length ? samples.reduce((maximum, sample) => Math.max(maximum, sample), 0) : null,
    }];
  }));
  return {
    model: plan.version, sourceCommit, stage: plan.stage,
    stopReason: reason, reconciledBefore, reconciledAfter,
    warmupStarted, measuredStarted, measuredElapsedMs, maxInFlightScenarios: maxInFlight,
    startsPerSecond: measuredElapsedMs ? measuredStarted / (measuredElapsedMs / 1000) : null,
    actorStarts: counts, scenarios: timings,
    // Never infer request concurrency, server/DB/provider timing or user capacity from these.
    serverMetrics: "unmeasured", databaseMetrics: "unmeasured", providerMetrics: "synthetic-adapter-required",
  };
}
