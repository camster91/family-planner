/** @jest-environment jsdom */
import React from "react";
import { render, screen } from "@testing-library/react";
import { RecurringChoreRows } from "../RecurringChoreRows";
import { profileSetupMessages } from "@/i18n/profile-setup";
import type { Chore } from "@/types";

it.each(["en", "es"] as const)(
  "%s recurring summaries preserve erased profile identity instead of showing an unassigned account",
  (locale) => {
    const chores = ["2026-10-12", "2026-10-19"].map((due_date, index) => ({
      id: `erased-occurrence-${index}`,
      family_id: "fixture-family",
      title: "Tidy the toys",
      assigned_to: null,
      assigned_member_id: null,
      member_subject_erased: true,
      assignee: null,
      recurrence_id: "erased-series",
      recurrence_frequency: "weekly",
      frequency: "once",
      due_date,
      status: "pending",
      points: 0,
      difficulty: "easy",
      created_at: "2026-10-01",
    })) as unknown as (Chore & { assignee: null })[];
    render(
      <RecurringChoreRows
        chores={chores}
        now={new Date("2026-10-12T12:00:00Z")}
        locale={locale}
        renderRow={(chore) => <div key={chore.id}>{chore.title}</div>}
      />,
    );
    expect(
      screen.getByText(profileSetupMessages[locale].profileTargetRefresh, {
        exact: false,
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/Unassigned/)).toBeNull();
  },
);
