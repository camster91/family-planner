/** @jest-environment jsdom */
/** Authored for consolidated QA; this source has not been run. */
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { routineScheduleMessages } from "@/i18n/routine-schedule";
import { RoutineSavedRequestDetails } from "../RoutineSavedRequestDetails";
import type { RoutineRecoveryEntry } from "@/lib/routine-schedule-recovery-contract";
import type { RoutineAssignmentOption } from "@/lib/routine-schedule-view";
const command = {
  protocol: "herewoven.routine-schedule.v1",
  expected_user_id: "fixture-parent",
  expected_family_id: "fixture-family",
  issued_at: "2026-10-20T14:00:00.000Z",
  view_day: "2026-10-20",
  view_zone: "America/Toronto",
  action: "replace-future",
  stack_id: "fixture-stack",
  expected_version: 2,
  label: "Original morning",
  anchor: "After breakfast",
  schedule: {
    frequency: "weekly",
    starts_on: "2026-10-21",
    weekly_days: [1, 3],
    monthly_day: null,
  },
  steps: [
    {
      client_step_id: "client-a",
      template_id: "root-a",
      title: "Original first",
      description: "Original instructions",
      subject: { kind: "profile", member_id: "private-member-id" },
      points: 731,
      difficulty: "easy",
      icon: null,
      duration_minutes: 12,
    },
    {
      client_step_id: "client-b",
      template_id: "root-b",
      title: "Original second",
      description: null,
      subject: {
        kind: "account",
        user_id: "private-account-id",
        member_id: null,
      },
      points: null,
      difficulty: "medium",
      icon: null,
      duration_minutes: null,
    },
  ],
  removed_steps: [
    { template_id: "removed-root", disposition: "unstack-future" },
  ],
};
const assignments: RoutineAssignmentOption[] = [
  {
    subject: { kind: "profile", member_id: "private-member-id" },
    name: "Current child name",
    role: "child",
    canRepeat: true,
  },
];
it.each(["en", "es"] as const)(
  "%s shows original intent without hidden points, private IDs or mutation controls",
  (locale) => {
    const entry: RoutineRecoveryEntry = {
      kind: "schedule",
      key: "original_request_key_123",
      body: JSON.stringify(command),
    };
    const original = entry.body;
    const view = render(
      <I18nProvider locale={locale}>
        <RoutineSavedRequestDetails
          entry={entry}
          assignments={assignments}
          pointsEnabled={false}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByText(routineScheduleMessages[locale].originalDetails),
    ).toBeTruthy();
    expect(screen.getByText("Original first")).toBeTruthy();
    expect(screen.getByText("Original second")).toBeTruthy();
    expect(screen.getByText("Original instructions")).toBeTruthy();
    expect(screen.getByText(/Current child name/)).toBeTruthy();
    expect(
      screen.getByText(
        routineScheduleMessages[locale].originalMemberUnavailable,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(routineScheduleMessages[locale].unstack),
    ).toBeTruthy();
    expect(view.container.textContent).not.toContain("731");
    expect(view.container.textContent).not.toContain("private-member-id");
    expect(view.container.textContent).not.toContain("private-account-id");
    expect(screen.queryByRole("button")).toBeNull();
    expect(entry.body).toBe(original);
    view.rerender(
      <I18nProvider locale={locale}>
        <RoutineSavedRequestDetails
          entry={entry}
          assignments={[]}
          pointsEnabled
        />
      </I18nProvider>,
    );
    expect(view.container.textContent).toContain("731");
    expect(view.container.textContent).not.toContain("Current child name");
    expect(entry.body).toBe(original);
  },
);
