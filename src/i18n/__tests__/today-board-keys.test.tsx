/** @jest-environment jsdom */

import * as React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import {
  todayBoardEnglish,
  todayBoardMessages,
  todayBoardSpanish,
  useTodayBoardText,
} from "../today-board";

it("keeps the Today/fridge board dictionaries aligned and nonempty", () => {
  expect(Object.keys(todayBoardSpanish).sort()).toEqual(
    Object.keys(todayBoardEnglish).sort(),
  );
  for (const [key, english] of Object.entries(todayBoardEnglish)) {
    const spanish = todayBoardSpanish[key as keyof typeof todayBoardSpanish];
    expect(spanish.trim()).not.toBe("");
    expect((spanish.match(/\{\w+\}/g) || []).sort()).toEqual(
      (english.match(/\{\w+\}/g) || []).sort(),
    );
  }
  expect(todayBoardMessages.en).toBe(todayBoardEnglish);
  expect(todayBoardMessages.es).toBe(todayBoardSpanish);
});

function BoardCopyProbe() {
  const text = useTodayBoardText();
  return <p data-testid="board-copy">{text("today")}</p>;
}

it("resolves route-owned copy through the shared locale context", () => {
  const { rerender } = render(
    <I18nProvider locale="es">
      <BoardCopyProbe />
    </I18nProvider>,
  );
  expect(screen.getByTestId("board-copy").textContent).toBe("Hoy");

  rerender(
    <I18nProvider locale="en" pseudolocalize>
      <BoardCopyProbe />
    </I18nProvider>,
  );
  expect(screen.getByTestId("board-copy").textContent).toMatch(/^⟦.+⟧$/);
});
