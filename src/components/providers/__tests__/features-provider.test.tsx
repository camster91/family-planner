/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  defaultFeatures,
  type FamilyFeatures,
  type FeatureKey,
} from "@/lib/features";
import { FeaturesProvider, useFeatures } from "../features-provider";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function response(features: FamilyFeatures): Response {
  return {
    ok: true,
    json: async () => ({ features }),
  } as Response;
}

function FeatureHarness() {
  const { features, refresh, setFeature } = useFeatures();
  const toggle = (key: FeatureKey) => {
    void setFeature(key, true).catch(() => undefined);
  };

  return (
    <>
      <button type="button" onClick={() => toggle("gamification")}>
        Turn on points
      </button>
      <button type="button" onClick={() => toggle("budget")}>
        Turn on budget
      </button>
      <button
        type="button"
        onClick={() => void refresh().catch(() => undefined)}
      >
        Refresh features
      </button>
      <output aria-label="points">{String(features.gamification)}</output>
      <output aria-label="budget">{String(features.budget)}</output>
      <output aria-label="rewards">{String(features.rewards)}</output>
    </>
  );
}

function renderFeatures(initial = defaultFeatures()) {
  return render(
    <FeaturesProvider initial={initial}>
      <FeatureHarness />
    </FeaturesProvider>,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as { fetch?: typeof fetch }).fetch;
});

function mockFetch() {
  const fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: fetchMock,
    writable: true,
  });
  return fetchMock;
}

it("serializes toggles and preserves full-map dependencies from each response", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const fetchMock = mockFetch();
  fetchMock
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const user = userEvent.setup();

  renderFeatures();
  await user.click(screen.getByRole("button", { name: "Turn on points" }));
  await user.click(screen.getByRole("button", { name: "Turn on budget" }));

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
    key: "gamification",
    enabled: true,
  });
  expect(screen.getByLabelText("points")).toHaveTextContent("true");
  expect(screen.getByLabelText("budget")).toHaveTextContent("true");

  const firstServer = {
    ...defaultFeatures(),
    gamification: true,
    rewards: true,
  };
  first.resolve(response(firstServer));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
    key: "budget",
    enabled: true,
  });
  expect(screen.getByLabelText("rewards")).toHaveTextContent("true");

  second.resolve(response({ ...firstServer, budget: true }));
  await waitFor(() =>
    expect(screen.getByLabelText("budget")).toHaveTextContent("true"),
  );
  expect(screen.getByLabelText("rewards")).toHaveTextContent("true");
});

it("releases the queue after a failed toggle so a later toggle can complete", async () => {
  const failed = deferred<Response>();
  const next = deferred<Response>();
  const fetchMock = mockFetch();
  fetchMock
    .mockReturnValueOnce(failed.promise)
    .mockReturnValueOnce(next.promise);
  const user = userEvent.setup();

  renderFeatures();
  await user.click(screen.getByRole("button", { name: "Turn on points" }));
  await user.click(screen.getByRole("button", { name: "Turn on budget" }));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  failed.reject(new Error("offline"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("points")).toHaveTextContent("false");
  expect(screen.getByLabelText("budget")).toHaveTextContent("true");

  next.resolve(response({ ...defaultFeatures(), budget: true }));
  await waitFor(() =>
    expect(screen.getByLabelText("budget")).toHaveTextContent("true"),
  );
  expect(screen.getByLabelText("points")).toHaveTextContent("false");
});

it("queues a refresh behind an in-flight toggle", async () => {
  const patch = deferred<Response>();
  const refresh = deferred<Response>();
  const fetchMock = mockFetch()
    .mockReturnValueOnce(patch.promise)
    .mockReturnValueOnce(refresh.promise);
  const user = userEvent.setup();

  renderFeatures();
  await user.click(screen.getByRole("button", { name: "Turn on points" }));
  await user.click(screen.getByRole("button", { name: "Refresh features" }));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const server = { ...defaultFeatures(), gamification: true, rewards: true };
  patch.resolve(response(server));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1][1]).toEqual({ cache: "no-store" });

  refresh.resolve(response(server));
  await waitFor(() =>
    expect(screen.getByLabelText("rewards")).toHaveTextContent("true"),
  );
  expect(screen.getByLabelText("points")).toHaveTextContent("true");
});
