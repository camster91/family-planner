/** Authored source only. Consolidated QA, including these cases, is deferred. */
import * as React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import ResponsibilitySheet from "../ResponsibilitySheet";
import { responsibilityMessages } from "@/i18n/responsibility";
import {
  readResponsibilityContext,
  readResponsibility,
  inspectResponsibility,
  sendResponsibility,
} from "@/lib/responsibility-client";
import { browserResponsibilityRecovery } from "@/lib/responsibility-browser";
import { RESPONSIBILITY_PROTOCOL } from "@/lib/responsibility";
import type { ResponsibilityView } from "@/lib/responsibility-http-contract";
import type { ResponsibilityRecoveryEntry } from "@/lib/responsibility-recovery";
jest.mock("@/components/ui/use-display-locale", () => ({
  useDisplayLocale: () => "en-CA",
}));
jest.mock("@/i18n/responsibility", () => {
  const actual = jest.requireActual("@/i18n/responsibility");
  return {
    ...actual,
    useResponsibilityText: () => actual.responsibilityMessages.en,
  };
});
jest.mock("@/lib/responsibility-client", () => ({
  ...jest.requireActual("@/lib/responsibility-client"),
  readResponsibilityContext: jest.fn(),
  readResponsibility: jest.fn(),
  inspectResponsibility: jest.fn(),
  sendResponsibility: jest.fn(),
}));
jest.mock("@/lib/responsibility-browser", () => ({
  browserResponsibilityRecovery: jest.fn(),
}));
const copy = responsibilityMessages.en;
const target = { kind: "chore", id: "chore-a" } as const;
const context = {
  contract: "herewoven.responsibility-recovery.v1",
  enabled: true,
  owner: {
    kind: "person",
    ownerId: "user-a",
    scope: "a".repeat(64),
    householdScope: "b".repeat(64),
    generation: 0,
  },
  userId: "user-a",
  familyId: "family-a",
  role: "parent",
} as const;
const snapshot: ResponsibilityView = {
  protocol: RESPONSIBILITY_PROTOCOL,
  owner: { userId: "user-a", familyId: "family-a" },
  target,
  title: "Put toys away",
  href: "/dashboard/chores",
  sourceToken: "c".repeat(64),
  revision: 0,
  active: true,
  writesEnabled: true,
  role: "parent",
  primary: {
    member: {
      subject: { kind: "profile", memberId: "profile-a" },
      name: "Little one",
    },
    statement: null,
  },
  backup: null,
  sourceChanged: false,
  choices: [],
  moreChoices: false,
};
const props = { target, onClose: jest.fn(), onOpen: jest.fn() };
const entry: ResponsibilityRecoveryEntry = {
  kind: "responsibility",
  key: "saved_responsibility_a",
  body: JSON.stringify({
    protocol: RESPONSIBILITY_PROTOCOL,
    userId: context.userId,
    familyId: context.familyId,
    target,
    sourceToken: snapshot.sourceToken,
    expectedRevision: 0,
    issuedAt: "2026-10-20T16:00:00.000Z",
    action: "state-intent",
    slot: "primary",
    decision: "accepted",
    method: "parent-recorded",
  }),
};
function setup(rows: ResponsibilityRecoveryEntry[] = []) {
  let saved = [...rows];
  const store = {
    initialize: jest.fn(async () => saved),
    stage: jest.fn(async (value: ResponsibilityRecoveryEntry) => {
      saved = [...saved, value];
    }),
    send: jest.fn(
      async (key: string, _review: boolean, send: typeof sendResponsibility) =>
        send(
          saved.find((value) => value.key === key)!,
          context.owner.scope,
        ),
    ),
    inspect: jest.fn(
      async (key: string, inspect: typeof inspectResponsibility) =>
        inspect(
          saved.find((value) => value.key === key)!,
          context,
        ),
    ),
    dismiss: jest.fn(async (key: string) => {
      saved = saved.filter((value) => value.key !== key);
    }),
    recoverStorage: jest.fn(async () => saved),
    hasUncertainStorage: jest.fn(() => false),
    writesAvailable: jest.fn(() => true),
  };
  jest
    .mocked(browserResponsibilityRecovery)
    .mockReturnValue(
      store as unknown as ReturnType<typeof browserResponsibilityRecovery>,
    );
  jest.mocked(readResponsibilityContext).mockResolvedValue(context);
  jest.mocked(readResponsibility).mockResolvedValue(snapshot);
  jest.mocked(sendResponsibility).mockResolvedValue({ kind: "unknown" });
  return store;
}
beforeEach(() => jest.resetAllMocks());
async function ready() {
  await screen.findByRole("button", { name: copy.recordAccept });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: copy.recordAccept }),
    ).not.toBeDisabled(),
  );
}
it("labels a profile answer as parent-recorded, previews it, and persists exact intent before sending", async () => {
  const store = setup();
  render(<ResponsibilitySheet {...props} />);
  await ready();
  expect(sendResponsibility).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: copy.recordAccept }));
  expect(screen.getByText(copy.preview)).toBeInTheDocument();
  expect(store.stage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: copy.confirm }));
  await screen.findByText(copy.unknown);
  const staged = store.stage.mock.calls[0][0];
  expect(JSON.parse(staged.body)).toMatchObject({
    target,
    action: "state-intent",
    method: "parent-recorded",
    slot: "primary",
    decision: "accepted",
    sourceToken: snapshot.sourceToken,
    expectedRevision: 0,
  });
  expect(sendResponsibility).toHaveBeenCalledWith(staged, context.owner.scope);
  expect(store.stage.mock.invocationCallOrder[0]).toBeLessThan(
    store.send.mock.invocationCallOrder[0],
  );
  expect(store.dismiss).not.toHaveBeenCalled();
});
it("does not let a parent confirm for another signed-in account", async () => {
  setup();
  jest.mocked(readResponsibility).mockResolvedValue({
    ...snapshot,
    primary: {
      member: {
        subject: { kind: "account", accountId: "other-account" },
        name: "Another parent",
      },
      statement: null,
    },
  });
  render(<ResponsibilitySheet {...props} />);
  await screen.findByText("Another parent");
  expect(
    screen.queryByRole("button", { name: copy.accept }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: copy.recordAccept }),
  ).not.toBeInTheDocument();
});
it("closing while persistence is pending never starts a late network mutation", async () => {
  const store = setup();
  let release!: () => void;
  store.stage.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const rendered = render(<ResponsibilitySheet {...props} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: copy.recordAccept }));
  fireEvent.click(screen.getByRole("button", { name: copy.confirm }));
  await waitFor(() => expect(store.stage).toHaveBeenCalledTimes(1));
  // Closing invalidates the operation synchronously, before router navigation
  // has unmounted the sheet.
  fireEvent.click(screen.getByRole("button", { name: copy.close }));
  expect(props.onClose).toHaveBeenCalled();
  await act(async () => {
    release();
  });
  rendered.unmount();
  expect(store.send).not.toHaveBeenCalled();
  expect(sendResponsibility).not.toHaveBeenCalled();
});
it("keeps recovery accessible when the current target can no longer be read; no automatic resend", async () => {
  const store = setup([entry]);
  jest.mocked(readResponsibility).mockRejectedValue(new Error("Unavailable"));
  render(<ResponsibilitySheet {...props} />);
  await screen.findByRole("button", { name: copy.check });
  expect(store.initialize).toHaveBeenCalledTimes(1);
  expect(store.send).not.toHaveBeenCalled();
  jest.mocked(inspectResponsibility).mockResolvedValue({
    contract: context.contract,
    ownerScope: context.owner.scope,
    entry,
    state: "expired",
    canRetry: false,
    currentRevision: null,
    receipt: null,
  });
  fireEvent.click(screen.getByRole("button", { name: copy.check }));
  await screen.findByText(copy.states.expired);
  expect(
    screen.queryByRole("button", { name: copy.retry }),
  ).not.toBeInTheDocument();
  expect(store.dismiss).not.toHaveBeenCalled();
});
it("does not resurrect a request after uncertain local deletion is recovered as empty", async () => {
  const store = setup([entry]);
  store.dismiss.mockRejectedValueOnce(new Error("Interrupted local delete"));
  store.hasUncertainStorage.mockReturnValue(true);
  store.recoverStorage.mockResolvedValue([]);
  render(<ResponsibilitySheet {...props} />);
  await screen.findByRole("button", { name: copy.forget });
  fireEvent.click(screen.getByRole("button", { name: copy.forget }));
  fireEvent.click(screen.getByRole("button", { name: copy.forgetConfirm }));
  await screen.findByText(copy.storage);
  fireEvent.click(screen.getByRole("button", { name: copy.repair }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: copy.check }),
    ).not.toBeInTheDocument(),
  );
  expect(store.stage).not.toHaveBeenCalled();
  expect(store.send).not.toHaveBeenCalled();
});
