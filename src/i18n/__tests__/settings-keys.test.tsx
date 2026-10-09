/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import {
  SettingsText,
  useCalendarSyncCopy,
  useSettingsCopy,
} from "@/app/dashboard/settings/settings-copy";
import {
  settingsMessages,
  settingsFeedback,
  settingsFeedbackEnglish,
  settingsError,
  settingsResponseError,
  SettingsFeedbackError,
} from "../settings";
import { pseudolocalizeTemplate } from "../pseudo";
import { describeCalendarSync } from "@/lib/calendar-sync-status";
it("all scoped keys have nonempty EN/ES parameter parity", () => {
  expect(Object.keys(settingsMessages.en).sort()).toEqual(
    Object.keys(settingsMessages.es).sort(),
  );
  for (const [key, text] of Object.entries(settingsMessages.en)) {
    const translated =
      settingsMessages.es[key as keyof typeof settingsMessages.es];
    expect(translated.trim()).not.toBe("");
    expect((translated.match(/\{\w+\}/g) ?? []).sort()).toEqual(
      (text.match(/\{\w+\}/g) ?? []).sort(),
    );
  }
});
it("tagged fallback identity never translates raw provider/unknown errors, including a raw refusal equal to a local sentence", () => {
  const key = "feedFailed";
  const raw = settingsMessages.en[key];
  expect(
    settingsError(new SettingsFeedbackError(settingsFeedback(key)), key),
  ).toEqual(settingsFeedback(key));
  expect(settingsError(new Error(raw), key)).toEqual({ raw });
  expect(settingsResponseError(raw, key)).toEqual({ raw });
  expect(settingsResponseError(null, key)).toEqual(settingsFeedback(key));
  expect(settingsError("non-Error rejection", key)).toEqual(
    settingsFeedback(key),
  );
  expect(
    settingsFeedbackEnglish(
      settingsFeedback("waitingOwner", { name: "Private {name} 李" }),
    ),
  ).toBe("Waiting for Private {name} 李 to choose a calendar.");
});
for (const locale of ["en", "es"] as const)
  for (const expanded of [false, true])
    it(`${locale}/expanded=${expanded}: semantic counts and private/raw parameters render once without interpreting markup or nested tokens`, () => {
      const provider = "Provider {provider} <b>李</b>";
      const wrap = (s: string) => (expanded ? pseudolocalizeTemplate(s) : s);
      render(
        <I18nProvider locale={locale} pseudolocalize={expanded}>
          <p data-testid="owned">
            <SettingsText
              feedback={settingsFeedback("disconnected", { provider })}
            />
          </p>
          <p data-testid="raw">
            <SettingsText feedback={{ raw: provider }} />
          </p>
          <p data-testid="counts">
            <SettingsText
              feedback={settingsFeedback("refreshedCounts", {
                created: 2,
                updated: 0,
                deleted: 3,
              })}
            />
          </p>
        </I18nProvider>,
      );
      expect(screen.getByTestId("owned").textContent).toBe(
        wrap(settingsMessages[locale].disconnected).replace(
          "{provider}",
          provider,
        ),
      );
      expect(screen.getByTestId("raw").textContent).toBe(provider);
      expect(screen.getByTestId("counts").textContent).toBe(
        wrap(settingsMessages[locale].refreshedCounts)
          .replace("{created}", "2")
          .replace("{updated}", "0")
          .replace("{deleted}", "3"),
      );
      expect(document.querySelector("b")).toBeNull();
    });
function ClockProbe({
  then,
  now,
  error,
  failed,
  verb,
}: {
  then: string | null;
  now: number;
  error: string | null;
  failed: boolean;
  verb: "synced" | "updated";
}) {
  const copy = useSettingsCopy();
  const messages = useCalendarSyncCopy();
  return (
    <p data-testid="clock">
      {
        describeCalendarSync({
          lastAttemptAt: then,
          now,
          error,
          failed,
          verb,
          failedFallback: copy(
            verb === "synced" ? "syncLastFailed" : "refreshLastFailed",
          ),
          messages,
        }).text
      }
    </p>
  );
}
it("optional English presentation is byte-compatible with canonical clock/error policy across boundaries, invalid/future values and both verbs", () => {
  const now = Date.parse("2026-01-05T12:00:00Z");
  for (const then of [
    null,
    "invalid",
    new Date(now + 60000).toISOString(),
    ...[0, 59999, 60000, 3599999, 3600000, 86400000, 3 * 86400000].map((n) =>
      new Date(now - n).toISOString(),
    ),
  ])
    for (const verb of ["synced", "updated"] as const)
      for (const failed of [false, true])
        for (const error of [null, " raw {time} 李.. "]) {
          const v = render(
            <I18nProvider locale="en">
              <ClockProbe
                then={then}
                now={now}
                error={error}
                failed={failed}
                verb={verb}
              />
            </I18nProvider>,
          );
          expect(screen.getByTestId("clock").textContent).toBe(
            describeCalendarSync({
              lastAttemptAt: then,
              now,
              error,
              failed,
              verb,
              failedFallback:
                verb === "synced"
                  ? "The last sync failed."
                  : "The last refresh failed.",
            }).text,
          );
          v.unmount();
        }
});
it("Spanish clock words use canonical rounding and preserve private error parameters", () => {
  const now = Date.parse("2026-01-05T12:00:00Z");
  render(
    <I18nProvider locale="es">
      <ClockProbe
        then={new Date(now - 180000).toISOString()}
        now={now}
        error="Raw {time} 李"
        failed
        verb="synced"
      />
    </I18nProvider>,
  );
  expect(screen.getByTestId("clock").textContent).toBe(
    "Raw {time} 李. Último intento hace 3 min.",
  );
});
