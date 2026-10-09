/** @jest-environment jsdom */
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { pseudolocalizeTemplate } from "../pseudo";

const dictionary = {
  en: { greeting: "Move “{item}”", state: "On" },
  es: { greeting: "Mover “{item}”", state: "Activado" },
};
const name = "Milk {state} 🥛";
function Probe() {
  const { t, setLocale } = useTranslation();
  return (
    <>
      <button onClick={() => setLocale("es")}>Switch locale</button>
      <p data-testid="scoped">
        {Reflect.apply(t, undefined, ["greeting", { item: name }, dictionary])}
      </p>
      <p data-testid="root">{t("preferences.language")}</p>
      <p data-testid="missing">
        {Reflect.apply(t, undefined, ["unknown", { item: name }, dictionary])}
      </p>
    </>
  );
}
it("translates a route-owned dictionary on locale change without changing root keys or inserted household text", () => {
  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByTestId("scoped").textContent).toBe(`Move “${name}”`);
  expect(screen.getByTestId("root").textContent).toBe("Language");
  fireEvent.click(screen.getByRole("button", { name: "Switch locale" }));
  expect(screen.getByTestId("scoped").textContent).toBe(`Mover “${name}”`);
  expect(screen.getByTestId("root").textContent).toBe("Idioma");
  expect(screen.getByTestId("missing").textContent).toBe("unknown");
});
it("expands scoped templates before single-pass interpolation and keeps missing keys intact", () => {
  render(
    <I18nProvider pseudolocalize>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByTestId("scoped").textContent).toBe(
    pseudolocalizeTemplate(dictionary.en.greeting).replace("{item}", name),
  );
  expect(screen.getByTestId("missing").textContent).toBe("unknown");
});

it("keeps existing provider-free root fallback and uses English for an explicitly scoped dictionary", () => {
  render(<Probe />);
  expect(screen.getByTestId("root").textContent).toBe("preferences.language");
  expect(screen.getByTestId("scoped").textContent).toBe(`Move “${name}”`);
  expect(screen.getByTestId("missing").textContent).toBe("unknown");
});
