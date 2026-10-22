"use client";
import * as React from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import { requestOwnedJson } from "@/lib/owned-request-http";
import {
  aiUsagePolicy,
  aiUsageReport,
  usdToMicrousd,
  microusdToUsd,
  type AiUsageReport,
} from "@/lib/ai-usage-contract";
type Form = {
  enabled: boolean;
  daily: string;
  userDaily: string;
  budget: string;
  input: string;
  output: string;
};
const formFor = (data: AiUsageReport): Form => ({
  enabled: data.policy.enabled,
  daily: String(data.policy.dailyLimit),
  userDaily: String(data.policy.userDailyLimit),
  budget: microusdToUsd(data.policy.monthlyBudgetMicrousd),
  input: microusdToUsd(data.policy.inputRateMicrousdPerMillion),
  output: microusdToUsd(data.policy.outputRateMicrousdPerMillion),
});
/** Parent-only live projection. No prompt, member names or per-call timeline. */
export function AiUsagePanel({
  identity,
  refreshKey = 0,
}: {
  identity: { userId: string; familyId: string };
  refreshKey?: number;
}) {
  const { locale } = useTranslation(),
    es = locale === "es";
  const copy = (en: string, translated: string) => (es ? translated : en);
  const scope = JSON.stringify(identity),
    initial = React.useRef(scope),
    latest = React.useRef(scope);
  latest.current = scope;
  const owner = React.useRef<AiUsageReport["owner"] | null>(null),
    retired = React.useRef(false),
    epoch = React.useRef(0),
    flight = React.useRef<AbortController | null>(null);
  const [data, setData] = React.useState<AiUsageReport | null>(null),
    [form, setForm] = React.useState<Form | null>(null),
    [busy, setBusy] = React.useState(false),
    [blocked, setBlocked] = React.useState(false),
    [error, setError] = React.useState(false),
    [invalid, setInvalid] = React.useState(false),
    [saved, setSaved] = React.useState(false);
  const invalidate = React.useCallback(() => {
    epoch.current++;
    flight.current?.abort();
    flight.current = null;
    setData(null);
    setForm(null);
    setBusy(false);
    setSaved(false);
  }, []);
  const send = async (write: boolean) => {
    if (
      busy ||
      retired.current ||
      scope !== initial.current ||
      document.visibilityState !== "visible"
    )
      return;
    setBusy(true);
    if (!write) {
      setData(null);
      setForm(null);
    }
    setError(false);
    setInvalid(false);
    setSaved(false);
    const token = ++epoch.current,
      controller = new AbortController();
    flight.current?.abort();
    flight.current = controller;
    let body: string | undefined;
    let sent = false;
    try {
      if (write) {
        if (!form || !data || !owner.current || !data.ready || blocked)
          throw new Error("Unavailable");
        const money = (value: string) =>
          value.trim() === "" ? null : usdToMicrousd(value);
        if (
          [form.budget, form.input, form.output].some(
            (v) => v.trim() !== "" && usdToMicrousd(v) === null,
          ) ||
          !/^\d+$/.test(form.daily) ||
          !/^\d+$/.test(form.userDaily)
        )
          throw new Error("Invalid limits");
        const policy = aiUsagePolicy.parse({
          enabled: form.enabled,
          dailyLimit: Number(form.daily),
          userDailyLimit: Number(form.userDaily),
          monthlyBudgetMicrousd: money(form.budget),
          inputRateMicrousdPerMillion: money(form.input),
          outputRateMicrousdPerMillion: money(form.output),
        });
        body = JSON.stringify({
          owner: owner.current,
          expectedRevision: data.revision,
          configVersion: data.configVersion,
          policy,
        });
      }
      sent = true;
      const result = await requestOwnedJson(
        "/api/family/ai-usage",
        {
          method: write ? "POST" : "GET",
          signal: controller.signal,
          ...(body
            ? { headers: { "Content-Type": "application/json" }, body }
            : {}),
        },
        128 * 1024,
      );
      if (
        token !== epoch.current ||
        latest.current !== initial.current ||
        controller.signal.aborted ||
        document.visibilityState !== "visible"
      )
        return;
      if (result.kind !== "reply") {
        if (write) setBlocked(true);
        throw new Error("Unknown result");
      }
      if ([401, 403].includes(result.response.status)) {
        retired.current = true;
        invalidate();
        throw new Error("Owner unavailable");
      }
      if (
        result.response.status === 409 &&
        typeof result.body === "object" &&
        result.body !== null &&
        "code" in result.body &&
        result.body.code === "AI_USAGE_OWNER_CHANGED"
      ) {
        retired.current = true;
        invalidate();
        return;
      }
      if (!result.response.ok) {
        if (write) setBlocked(true);
        throw new Error("Unavailable");
      }
      const current = aiUsageReport.parse(result.body),
        prior = owner.current;
      if (
        current.owner.userId !== identity.userId ||
        current.owner.familyId !== identity.familyId ||
        (prior && current.owner.generation !== prior.generation)
      ) {
        retired.current = true;
        invalidate();
        throw new Error("Owner changed");
      }
      owner.current ??= current.owner;
      setData(current);
      setForm(formFor(current));
      setBlocked(false);
      setSaved(write);
    } catch {
      if (token === epoch.current) {
        setError(true);
        if (write && sent) setBlocked(true);
        if (write && !sent) setInvalid(true);
      }
    } finally {
      if (token === epoch.current) {
        setBusy(false);
        flight.current = null;
      }
    }
  };
  React.useEffect(() => {
    void send(false);
    const hide = () => {
      if (document.visibilityState === "hidden") invalidate();
    };
    window.addEventListener("blur", invalidate);
    window.addEventListener("storage", invalidate);
    document.addEventListener("visibilitychange", hide);
    return () => {
      invalidate();
      window.removeEventListener("blur", invalidate);
      window.removeEventListener("storage", invalidate);
      document.removeEventListener("visibilitychange", hide);
    };
    // The controller belongs to its original server-provided parent identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, refreshKey, invalidate]);
  const valid = !retired.current && scope === initial.current;
  const month =
    data?.days.filter((day) => day.day.startsWith(data.month)) ?? [];
  const attempts = month.reduce((n, d) => n + d.attempts, 0),
    accepted = month.reduce((n, d) => n + d.accepted, 0),
    unknown = month.reduce((n, d) => n + d.unknownCostCalls, 0),
    measured = month.reduce((n, d) => n + d.measuredCalls, 0);
  const unknownTokens = month.reduce((n, day) => n + day.unknownTokenCalls, 0);
  const sum = (
    key:
      | "estimatedMicrousd"
      | "reservedMicrousd"
      | "latencyTotalMs"
      | "inputTokens"
      | "outputTokens",
  ) => month.reduce((n, d) => n + BigInt(d[key]), BigInt(0)).toString();
  const field = (
    key: "daily" | "userDaily" | "budget" | "input" | "output",
    label: string,
    max?: number,
  ) => (
    <label className="block space-y-1">
      <span>{label}</span>
      <input
        className="input-field min-h-11 w-full"
        type="number"
        inputMode={
          key === "daily" || key === "userDaily" ? "numeric" : "decimal"
        }
        min={key === "daily" || key === "userDaily" ? 1 : 0}
        max={max}
        step={key === "daily" || key === "userDaily" ? 1 : "0.000001"}
        disabled={busy || !data?.ready || blocked}
        value={form?.[key] ?? ""}
        onChange={(event) =>
          setForm(
            (previous) =>
              previous && { ...previous, [key]: event.target.value },
          )
        }
      />
    </label>
  );
  return (
    <section
      className="space-y-4 border-t border-[var(--surface-separator)] pt-4"
      aria-label={copy("AI usage and limits", "Uso y límites de IA")}
    >
      <h3 className="font-semibold">
        {copy("AI usage and limits", "Uso y límites de IA")}
      </h3>
      <p className="text-footnote text-label-secondary">
        {copy(
          "Assistant and text/photo capture. Usage stores counts only, never prompts or family content. Days and limits use UTC.",
          "Asistente y captura de texto/fotos. Solo se guardan contadores, nunca mensajes ni contenido familiar. Los días y límites usan UTC.",
        )}
      </p>
      {!valid ? (
        <p role="status">
          {copy(
            "Your session changed. Reload Settings.",
            "Tu sesión cambió. Recarga Ajustes.",
          )}
        </p>
      ) : (
        <>
          <button
            type="button"
            className="btn-secondary min-h-11"
            disabled={busy}
            onClick={() => void send(false)}
          >
            {busy
              ? copy("Loading…", "Cargando…")
              : copy("Refresh usage and limits", "Actualizar uso y límites")}
          </button>
          {error && (
            <p role="alert" className="text-danger-text">
              {invalid
                ? copy(
                    "Check the limits and complete both token rates when using a cost limit.",
                    "Revisa los límites y completa ambas tarifas si usas un límite de costo.",
                  )
                : copy(
                    "Could not confirm usage or settings. Refresh before saving again; app controls remain available.",
                    "No se pudo confirmar el uso o los ajustes. Actualiza antes de guardar de nuevo; los controles de la app siguen disponibles.",
                  )}
            </p>
          )}
          {saved && (
            <p role="status">
              {copy("AI limits saved.", "Límites de IA guardados.")}
            </p>
          )}
          {data && form && (
            <>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <dt>
                    {copy("AI attempts this month", "Intentos de IA este mes")}
                  </dt>
                  <dd>{attempts}</dd>
                </div>
                <div>
                  <dt>{copy("Accepted replies", "Respuestas aceptadas")}</dt>
                  <dd>{accepted}</dd>
                </div>
                <div>
                  <dt>
                    {copy(
                      "Known cost estimate (USD)",
                      "Estimación conocida (USD)",
                    )}
                  </dt>
                  <dd>${microusdToUsd(sum("estimatedMicrousd"))}</dd>
                </div>
                <div>
                  <dt>
                    {copy("Average measured latency", "Latencia media medida")}
                  </dt>
                  <dd>
                    {measured
                      ? `${Math.round(Number(sum("latencyTotalMs")) / measured)} ms`
                      : copy("Unknown", "Desconocida")}
                  </dd>
                </div>
              </dl>
              <p className="text-footnote text-label-secondary">
                {copy(
                  "Calls without a price estimate",
                  "Llamadas sin estimación de precio",
                )}
                : {unknown}.{" "}
                {copy("Held estimate (USD)", "Estimación retenida (USD)")}: $
                {microusdToUsd(sum("reservedMicrousd"))}.{" "}
                {copy(
                  "Reported input / output tokens",
                  "Tokens de entrada / salida reportados",
                )}
                : {sum("inputTokens")} / {sum("outputTokens")}.{" "}
                {copy(
                  "Calls missing token reports",
                  "Llamadas sin datos de tokens",
                )}
                : {unknownTokens}.
              </p>
              <p className="text-footnote text-label-secondary">
                {copy(
                  "Costs use the USD token rates you enter, not provider invoices. Image billing and missing token reports can differ. Unfinished calls keep their quota reservation.",
                  "Los costos usan tus tarifas de tokens en USD, no facturas del proveedor. Las fotos y los tokens no reportados pueden diferir. Las llamadas sin terminar conservan su reserva.",
                )}
              </p>
              {data.providerPaused && (
                <p role="status">
                  {copy(
                    "New AI calls are paused. App controls remain available.",
                    "Las nuevas llamadas de IA están pausadas. Los controles de la app siguen disponibles.",
                  )}
                </p>
              )}
              {!data.ready && (
                <p role="status">
                  {copy(
                    "New AI calls and limit changes are paused.",
                    "Las nuevas llamadas de IA y los cambios de límites están pausados.",
                  )}
                </p>
              )}
              {!data.providerLabel && (
                <Link
                  href="/dashboard/settings?setup=ai#ai-capture"
                  className="inline-flex min-h-11 items-center underline"
                >
                  {copy(
                    "Connect a provider in AI capture settings",
                    "Conecta un proveedor en los ajustes de captura IA",
                  )}
                </Link>
              )}
              {data.providerLabel && (
                <p className="text-footnote [overflow-wrap:anywhere]">
                  {copy("Current provider", "Proveedor actual")}:{" "}
                  {data.providerLabel}
                </p>
              )}
              {data.policy.monthlyBudgetMicrousd !== null && unknown > 0 && (
                <p role="status">
                  {copy(
                    "Unpriced calls this month prevent new cost-limited calls. Remove the cost limit to use request limits, or wait for the next UTC month.",
                    "Las llamadas sin precio de este mes impiden nuevas llamadas con límite de costo. Quita ese límite para usar límites de llamadas, o espera al próximo mes UTC.",
                  )}
                </p>
              )}
              {!data.pricingCurrent && (
                <p role="status">
                  {copy(
                    "Review rates for the current provider before using a cost limit.",
                    "Revisa las tarifas del proveedor actual antes de usar un límite de costo.",
                  )}
                </p>
              )}
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={busy || !data.ready || blocked}
                  onChange={(event) =>
                    setForm({ ...form, enabled: event.target.checked })
                  }
                />
                {copy("Allow household AI", "Permitir IA familiar")}
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                {field(
                  "daily",
                  copy(
                    "Household calls per day",
                    "Llamadas familiares por día",
                  ),
                  10000,
                )}
                {field(
                  "userDaily",
                  copy(
                    "Calls per person per day",
                    "Llamadas por persona y día",
                  ),
                  1000,
                )}
              </div>
              <details>
                <summary className="min-h-11 cursor-pointer py-3">
                  {copy(
                    "Estimated cost controls (optional)",
                    "Controles de costo estimado (opcionales)",
                  )}
                </summary>
                <div className="space-y-4">
                  {field(
                    "budget",
                    copy(
                      "Monthly estimate limit, USD",
                      "Límite mensual estimado, USD",
                    ),
                    1000000,
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field(
                      "input",
                      copy(
                        "USD per million input tokens",
                        "USD por millón de tokens de entrada",
                      ),
                      1000,
                    )}
                    {field(
                      "output",
                      copy(
                        "USD per million output tokens",
                        "USD por millón de tokens de salida",
                      ),
                      1000,
                    )}
                  </div>
                  <p className="text-footnote text-label-secondary">
                    {copy(
                      "Leave the cost limit blank to use request limits only. Both rates must be supplied together. Saving binds them to the provider you just reviewed; changing its model or key requires review again.",
                      "Deja el límite de costo vacío para usar solo límites de llamadas. Completa ambas tarifas. Guardar las vincula al proveedor revisado; cambiar su modelo o clave exige revisarlas de nuevo.",
                    )}
                  </p>
                </div>
              </details>
              <button
                type="button"
                className="btn-primary min-h-11"
                disabled={busy || blocked || !data.ready}
                onClick={() => void send(true)}
              >
                {copy("Save AI limits", "Guardar límites de IA")}
              </button>
              <details>
                <summary className="min-h-11 cursor-pointer py-3">
                  {copy("Daily usage (UTC)", "Uso diario (UTC)")}
                </summary>
                <div
                  className="overflow-x-auto focus-visible:outline focus-visible:outline-accent"
                  tabIndex={0}
                  role="region"
                  aria-label={copy(
                    "Daily AI usage table",
                    "Tabla de uso diario de IA",
                  )}
                >
                  <table className="w-full text-start text-footnote">
                    <thead>
                      <tr>
                        <th>{copy("Day", "Día")}</th>
                        <th>{copy("Attempts", "Intentos")}</th>
                        <th>{copy("Accepted", "Aceptadas")}</th>
                        <th>
                          {copy("Refused replies", "Respuestas rechazadas")}
                        </th>
                        <th>{copy("Failed", "Fallidas")}</th>
                        <th>{copy("Unfinished", "Sin terminar")}</th>
                        <th>{copy("Timeouts", "Tiempo agotado")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.days.map((day) => (
                        <tr key={day.day}>
                          <td>{day.day}</td>
                          <td>{day.attempts}</td>
                          <td>{day.accepted}</td>
                          <td>{day.refused}</td>
                          <td>{day.failed}</td>
                          <td>{day.unfinished}</td>
                          <td>{day.timeouts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.days.length === 0 && (
                    <p>
                      {copy(
                        "No recorded AI calls in this window.",
                        "No hay llamadas de IA registradas en este período.",
                      )}
                    </p>
                  )}
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
