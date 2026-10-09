/** @jest-environment jsdom */
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockLoad = jest.fn();
const mockInit = jest.fn();
jest.mock("@/lib/load-posthog", () => ({ loadPostHog: () => mockLoad() }));
jest.mock("posthog-js", () => {
  (globalThis as typeof globalThis & { __eagerSDK?: boolean }).__eagerSDK =
    true;
  return {
    __esModule: true,
    default: { init: (...args: unknown[]) => mockInit(...args) },
  };
});
jest.mock("posthog-js/react", () => ({
  PostHogProvider: ({ children }: { children: React.ReactNode }) => children,
}));
import { PostHogProvider } from "../posthog-provider";

function Draft() {
  const [value, setValue] = React.useState("");
  return (
    <input
      aria-label="Unsent draft"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
const oldKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const oldHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
});
afterAll(() => {
  if (oldKey === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  else process.env.NEXT_PUBLIC_POSTHOG_KEY = oldKey;
  if (oldHost === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
  else process.env.NEXT_PUBLIC_POSTHOG_HOST = oldHost;
});

it("does not import or initialize the SDK without a configured key", () => {
  render(
    <PostHogProvider>
      <Draft />
    </PostHogProvider>,
  );
  expect(
    (globalThis as typeof globalThis & { __eagerSDK?: boolean }).__eagerSDK,
  ).toBeUndefined();
  expect(mockLoad).not.toHaveBeenCalled();
  expect(mockInit).not.toHaveBeenCalled();
});

it.each([undefined, "https://analytics.example.test"])(
  "keeps mounted drafts and original configured initialization options (%s)",
  async (host) => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "fabricated-build-key";
    if (host) process.env.NEXT_PUBLIC_POSTHOG_HOST = host;
    let resolve!: (client: { init: typeof mockInit }) => void;
    mockLoad.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { rerender } = render(
      <PostHogProvider>
        <Draft />
      </PostHogProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Unsent draft" });
    fireEvent.change(input, { target: { value: "Household {count} 🥛" } });
    expect(mockLoad).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ init: mockInit }));
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledWith("fabricated-build-key", {
      api_host: host || "https://app.posthog.com",
    });
    expect(screen.getByRole("textbox")).toBe(input);
    expect((input as HTMLInputElement).value).toBe("Household {count} 🥛");
    rerender(
      <PostHogProvider>
        <Draft />
      </PostHogProvider>,
    );
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockInit).toHaveBeenCalledTimes(1);
  },
);

it("does not initialize a late SDK after unmount", async () => {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "fabricated-build-key";
  let resolve!: (client: { init: typeof mockInit }) => void;
  mockLoad.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount } = render(
    <PostHogProvider>
      <Draft />
    </PostHogProvider>,
  );
  expect(mockLoad).toHaveBeenCalledTimes(1);
  unmount();
  await act(async () => resolve({ init: mockInit }));
  expect(mockInit).not.toHaveBeenCalled();
});

it("keeps a typed draft when the optional SDK cannot load", async () => {
  process.env.NEXT_PUBLIC_POSTHOG_KEY = "fabricated-build-key";
  let reject!: (error: Error) => void;
  mockLoad.mockImplementation(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    render(
      <PostHogProvider>
        <Draft />
      </PostHogProvider>,
    );
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Unsent household text" } });
    expect(mockLoad).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("isolated SDK failure")));
    expect(screen.getByRole("textbox")).toBe(input);
    expect((input as HTMLInputElement).value).toBe("Unsent household text");
    expect(mockInit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "Optional analytics could not initialize.",
    );
  } finally {
    warn.mockRestore();
  }
});
