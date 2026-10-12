/**
 * @jest-environment jsdom
 */
// Accessibility guard for the hand-made forms and modals that moved onto the
// shared Dialog: every button has an accessible name, every form control has
// a label, and each modal is a real dialog (role, name, Escape closes it).
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { computeAccessibleName } from "dom-accessibility-api";
import { FEATURES, type FamilyFeatures } from "@/lib/features";
import { ToastProvider } from "@/components/ui/toast";
import EmergencyPage from "../emergency/page";
import AnniversariesPage from "../anniversaries/page";
import NotesPage from "../notes/page";
import WishlistPage from "../wishlist/page";
import PickupsPage from "../pickups/page";
import AllowancePage from "../allowance/page";
import AllowanceCreateForm from "../allowance/create/AllowanceCreateForm";
import { AllowanceCreateSheet } from "@/components/layout/AllowanceFormSheets";

const allOn = Object.fromEntries(
  FEATURES.map((f) => [f.key, true]),
) as FamilyFeatures;

jest.mock("@/components/providers/features-provider", () => ({
  useFeatures: () => ({ features: allOn }),
  useFeatureEnabled: () => true,
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), back: jest.fn() }),
}));

const json = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);

// The emergency page's print CSS uses styled-jsx (`<style jsx global>`), which
// only the Next.js compiler understands; silence React's attribute warning.
const realError = console.error;
beforeAll(() => {
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      /non-boolean attribute `(jsx|global)`/.test(args[0])
    )
      return;
    realError(...args);
  });
});
afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/auth/me"))
      return json({ user: { id: "u1", role: "parent" } });
    if (url.startsWith("/api/family/members"))
      return json({ members: [{ id: "u1", name: "Sam" }] });
    if (url.startsWith("/api/emergency-contacts"))
      return json({ contacts: [] });
    if (url.startsWith("/api/anniversaries")) return json({ dates: [] });
    if (url.startsWith("/api/notes")) return json({ notes: [] });
    if (url.startsWith("/api/wishlist")) return json({ items: [] });
    if (url.startsWith("/api/pickups")) return json({ pickups: [] });
    if (url.startsWith("/api/allowance")) return json({ items: [] });
    return json({});
  }) as jest.Mock;
});

/** Every button and form control in `root` has a non-empty accessible name. */
function expectNamedControls(root: HTMLElement) {
  const unnamed: string[] = [];
  root
    .querySelectorAll<HTMLElement>("button, input, select, textarea")
    .forEach((el) => {
      if (
        el instanceof HTMLInputElement &&
        (el.type === "hidden" || el.classList.contains("hidden"))
      )
        return;
      if (!computeAccessibleName(el).trim())
        unnamed.push(el.outerHTML.slice(0, 120));
    });
  expect(unnamed).toEqual([]);
}

async function openDialog(trigger: RegExp, title: string) {
  const user = userEvent.setup();
  await user.click(
    (await screen.findAllByRole("button", { name: trigger }))[0],
  );
  const dialog = await screen.findByRole("dialog", { name: title });
  expect(dialog.getAttribute("aria-modal")).toBe("true");
  expectNamedControls(dialog);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

// The i18n context falls back to returning keys, so names below are keys.
it("emergency: add-card modal is a labelled dialog", async () => {
  render(<EmergencyPage />);
  await openDialog(/emergency\.addCard/, "emergency.addCard");
  expectNamedControls(document.body);
});

it("anniversaries: add-date modal is a labelled dialog", async () => {
  render(<AnniversariesPage />);
  await openDialog(/dates\.addDate/, "dates.addDate");
  expectNamedControls(document.body);
});

it("notes: note modal is a labelled dialog", async () => {
  render(<NotesPage />);
  await openDialog(/notes\.addNote/, "notes.newNote");
  expectNamedControls(document.body);
});

it("wishlist: add-wish modal is a labelled dialog", async () => {
  render(<WishlistPage />);
  await openDialog(/wishlist\.addWish/, "wishlist.addWish");
  expectNamedControls(document.body);
});

it.each([
  [
    "pickups",
    PickupsPage,
    "New pickup",
    ["Title", "When", "Location", "Assigned to", "Notes"],
  ],
] as const)(
  "%s: add form fields are labelled",
  async (_name, Page, heading, labels) => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Page />
      </ToastProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Add" }));
    const dialog = screen.queryByRole("dialog", { name: heading });
    const form =
      dialog ?? (screen.getByText(heading).closest("form") as HTMLElement);
    for (const label of labels)
      expect(within(form).getByLabelText(label)).toBeTruthy();
    expectNamedControls(document.body);
  },
);

it("allowance: Add is a named link to the routed creation form", async () => {
  render(
    <ToastProvider>
      <AllowancePage />
    </ToastProvider>,
  );
  const add = await screen.findByRole("link", { name: "Add" });
  expect(add.getAttribute("href")).toBe("/dashboard/allowance/create");
  expectNamedControls(document.body);
});

it.each([
  ["direct", AllowanceCreateForm],
  ["intercepted", AllowanceCreateSheet],
] as const)(
  "allowance: %s creation fields are labelled",
  async (variant, Form) => {
    render(<Form />);
    await screen.findByRole("option", { name: "Sam" });
    const form = screen.getByTestId("allowance-create-form");
    for (const label of ["For", "Amount", "Reason"])
      expect(within(form).getByLabelText(label)).toBeTruthy();
    if (variant === "intercepted") {
      const dialog = screen.getByRole("dialog", { name: "New allowance" });
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.contains(form)).toBe(true);
    }
    expectNamedControls(document.body);
  },
);
