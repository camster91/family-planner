/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { choreFormMessages } from "@/i18n/chore-forms";
import CreateChoreForm from "../create/CreateChoreForm";
import EditChoreForm from "../edit/EditChoreForm";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams({ id: "owned-chore" }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));
const previousPhoto = "/api/files/chores/1111111111111111.png";
const uploadedPhoto = "/api/files/chores/2222222222222222.png";
const response = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

for (const [mode, locale] of [
  ["create", "en"],
  ["edit", "es"],
] as const) {
  it(`${mode}: failed photo retry preserves the draft and blocks saving until upload completes (${locale})`, async () => {
    const user = userEvent.setup();
    const copy = choreFormMessages[locale];
    const writes: RequestInit[] = [];
    let uploads = 0;
    let finishUpload!: (value: ReturnType<typeof response>) => void;
    const heldUpload = new Promise<ReturnType<typeof response>>((resolve) => {
      finishUpload = resolve;
    });
    const nativeAlert = jest
      .spyOn(window, "alert")
      .mockImplementation(() => {});
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    push.mockClear();
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/family/members")
        return response({
          members: [{ id: "parent", name: "Parent", role: "parent" }],
        });
      if (url === "/api/family/profiles") return response({ profiles: [] });
      if (url.startsWith("/api/chores?id="))
        return response({
          chore: {
            id: "owned-chore",
            title: "Original title",
            description: "Original instructions",
            assigned_to: "parent",
            due_date: "2099-10-12T00:00:00.000Z",
            frequency: "once",
            difficulty: "medium",
            points: 10,
            photo_url: previousPhoto,
          },
        });
      if (url === "/api/upload") {
        uploads += 1;
        if (uploads === 1) return response({ error: "Synthetic refusal" }, 503);
        if (uploads === 2)
          return response({ url: "https://example.test/invalid-upload" });
        return heldUpload;
      }
      if (init?.method === "POST" || init?.method === "PATCH") {
        writes.push(init);
        return response({ chore: { id: "owned-chore" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    try {
      render(
        <I18nProvider locale={locale}>
          {mode === "create" ? <CreateChoreForm /> : <EditChoreForm />}
        </I18nProvider>,
      );
      const title = await screen.findByLabelText(copy.title);
      await screen.findByRole("option", { name: "Parent" });
      await user.clear(title);
      await user.type(title, "Keep this chore 原");
      if (mode === "create") {
        fireEvent.change(screen.getByLabelText(copy.dueDate), {
          target: { value: "2099-10-12" },
        });
        await user.selectOptions(
          screen.getByLabelText(copy.assignTo),
          "parent",
        );
      }
      const input = screen.getByLabelText(copy.photo, {
        selector: 'input[type="file"]',
      }) as HTMLInputElement;
      await user.click(input.closest("details")!.querySelector("summary")!);
      const file = new File(["synthetic image"], "family.png", {
        type: "image/png",
      });
      await user.upload(input, file);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        copy.uploadFailed,
      );
      expect(nativeAlert).not.toHaveBeenCalled();
      expect(title).toHaveValue("Keep this chore 原");
      if (mode === "edit")
        expect(screen.getByRole("img", { name: copy.preview })).toHaveAttribute(
          "src",
          previousPhoto,
        );
      expect(input.value).toBe("");
      await user.upload(input, file);
      await waitFor(() => expect(uploads).toBe(2));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        copy.uploadFailed,
      );
      expect(title).toHaveValue("Keep this chore 原");
      if (mode === "edit")
        expect(screen.getByRole("img", { name: copy.preview })).toHaveAttribute(
          "src",
          previousPhoto,
        );
      await user.upload(input, file);
      await waitFor(() => expect(uploads).toBe(3));
      const save = screen.getByRole("button", {
        name: mode === "create" ? copy.create : copy.save,
      });
      expect(save).toBeDisabled();
      expect(screen.queryByRole("alert")).toBeNull();
      fireEvent.submit(title.closest("form")!);
      expect(writes).toHaveLength(0);
      finishUpload(response({ url: uploadedPhoto }));
      await waitFor(() => expect(save).toBeEnabled());
      expect(screen.getByRole("img", { name: copy.preview })).toHaveAttribute(
        "src",
        uploadedPhoto,
      );
      await user.click(save);
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(JSON.parse(String(writes[0].body))).toMatchObject({
        title: "Keep this chore 原",
        photo_url: uploadedPhoto,
      });
    } finally {
      finishUpload(response({ url: uploadedPhoto }));
      nativeAlert.mockRestore();
      log.mockRestore();
    }
  });
}
