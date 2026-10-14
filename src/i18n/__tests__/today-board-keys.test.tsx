/** @jest-environment jsdom */

import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, LOCALE_STORAGE_KEY, useTranslation } from "@/i18n";
import { pseudolocalizeTemplate } from "../pseudo";
import { useScopedMessages } from "../locale-context";
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

function LocaleChangeProbe() {
  const { setLocale } = useTranslation();
  return (
    <button type="button" onClick={() => setLocale("es")}>
      Switch locale
    </button>
  );
}

it("updates mounted route-owned copy and persists a real locale change", async () => {
  window.localStorage.clear();
  render(
    <I18nProvider persistLocale locale="en">
      <LocaleChangeProbe />
      <BoardCopyProbe />
    </I18nProvider>,
  );

  expect(screen.getByTestId("board-copy").textContent).toBe("Today");
  fireEvent.click(screen.getByRole("button", { name: "Switch locale" }));
  await waitFor(() =>
    expect(screen.getByTestId("board-copy").textContent).toBe("Hoy"),
  );
  expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es");
});

const scopedTestMessages = {
  en: { greeting: "Hello {name}" },
  es: { greeting: "Hola {name}" },
} as const;

function ScopedMessageProbe() {
  const text = useScopedMessages(scopedTestMessages);
  return <p data-testid="scoped-copy">{text("greeting", { name: "Ari" })}</p>;
}

it("pseudolocalizes the template before inserting raw household parameters", () => {
  render(
    <I18nProvider locale="en" pseudolocalize>
      <ScopedMessageProbe />
    </I18nProvider>,
  );

  expect(screen.getByTestId("scoped-copy").textContent).toBe(
    pseudolocalizeTemplate(scopedTestMessages.en.greeting).replace(
      "{name}",
      "Ari",
    ),
  );
});

const unsafeTestMessages = {
  en: { known: "Known", nonString: { value: true } },
  es: { known: "Conocido", nonString: { value: true } },
} as unknown as Readonly<Record<"en" | "es", Readonly<Record<string, string>>>>;

function UnsafeMessageProbe() {
  const text = useScopedMessages(unsafeTestMessages);
  const resolve = text as unknown as (key: string) => string;
  return (
    <>
      <p data-testid="known-copy">{resolve("known")}</p>
      <p data-testid="missing-copy">{resolve("missing")}</p>
      <p data-testid="inherited-copy">{resolve("toString")}</p>
      <p data-testid="non-string-copy">{resolve("nonString")}</p>
    </>
  );
}

it("refuses missing, inherited, and non-string route-owned keys", () => {
  render(
    <I18nProvider locale="en">
      <UnsafeMessageProbe />
    </I18nProvider>,
  );

  expect(screen.getByTestId("known-copy").textContent).toBe("Known");
  expect(screen.getByTestId("missing-copy").textContent).toBe("missing");
  expect(screen.getByTestId("inherited-copy").textContent).toBe("toString");
  expect(screen.getByTestId("non-string-copy").textContent).toBe("nonString");
});

const missingSpanishMessages = {
  en: { englishOnly: "English-only copy" },
  es: {},
} as unknown as Readonly<
  Record<"en" | "es", Readonly<Record<string, string>>>
>;

function MissingSpanishMessageProbe() {
  const text = useScopedMessages(missingSpanishMessages);
  return <p data-testid="missing-spanish-copy">{text("englishOnly")}</p>;
}

it("does not silently fall back to English for a missing Spanish key", () => {
  const { rerender } = render(
    <I18nProvider locale="es">
      <MissingSpanishMessageProbe />
    </I18nProvider>,
  );
  expect(screen.getByTestId("missing-spanish-copy").textContent).toBe(
    "englishOnly",
  );

  rerender(
    <I18nProvider locale="es" pseudolocalize>
      <MissingSpanishMessageProbe />
    </I18nProvider>,
  );
  expect(screen.getByTestId("missing-spanish-copy").textContent).toBe(
    "englishOnly",
  );
});
