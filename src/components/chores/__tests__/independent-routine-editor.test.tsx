/** @jest-environment jsdom */
/** Authored only. No rendered/device acceptance has been run. */
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { routineScheduleMessages } from "@/i18n/routine-schedule";
import { IndependentRoutineEditor } from "../IndependentRoutineEditor";
import { independentEditorDraftSchema } from "@/lib/routine-independent-draft-contract";
const draft = independentEditorDraftSchema.parse({
  rootId: "root",
  revision: 3,
  state: "active",
  anchor: "After breakfast",
  schedule: {
    frequency: "weekly",
    starts_on: "2026-10-21",
    weekly_days: [1, 3],
    monthly_day: null,
  },
  content: {
    title: "Tidy toys",
    description: null,
    subject: { kind: "account", user_id: "parent", member_id: null },
    points: null,
    difficulty: "easy",
    icon: null,
    duration_minutes: 5,
  },
});
it.each(["en", "es"] as const)(
  "%s reviews an exact independent edit and hides disabled points and unavailable repeat profiles",
  (locale) => {
    const save = jest.fn(),
      change = jest.fn(),
      close = jest.fn(),
      t = routineScheduleMessages[locale];
    const view = render(
      <I18nProvider locale={locale}>
        <IndependentRoutineEditor
          open
          draft={draft}
          assignments={[
            {
              subject: { kind: "account", user_id: "parent", member_id: null },
              name: "Fixture parent",
              role: "parent",
              canRepeat: true,
            },
            {
              subject: { kind: "profile", member_id: "child" },
              name: "One-time child",
              role: "child",
              canRepeat: false,
            },
          ]}
          pointsEnabled={false}
          locked={false}
          saving={false}
          error={null}
          onChange={change}
          onClose={close}
          onSave={save}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("dialog", { name: t.independentEdit }),
    ).toBeTruthy();
    expect(screen.queryByText("One-time child", { exact: false })).toBeNull();
    expect(screen.queryByLabelText(t.points)).toBeNull();
    fireEvent.submit(view.container.querySelector("form")!);
    expect(screen.getByText("Tidy toys")).toBeTruthy();
    expect(screen.getAllByText(t.scope).length).toBeGreaterThan(0);
    expect(save).not.toHaveBeenCalled();
    fireEvent.submit(view.container.querySelector("form")!);
    expect(save).toHaveBeenCalledWith({
      at: expect.any(Date),
      zone: expect.any(String),
    });
    expect(change).not.toHaveBeenCalled();
  },
);
