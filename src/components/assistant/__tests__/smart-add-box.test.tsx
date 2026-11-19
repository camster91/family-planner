/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SmartAddBox } from "../SmartAddBox";

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let available = true;

const draftReply = {
  status: "ok",
  dropped: 0,
  drafts: [
    {
      id: "r0",
      kind: "event",
      title: "Dentist",
      date: "2026-11-24",
      startTime: "15:30",
      endTime: "16:30",
      start: "2026-11-24T20:30:00.000Z",
      end: "2026-11-24T21:30:00.000Z",
      people: [{ kind: "account", id: "child-a", name: "Casey" }],
      checkPeople: false,
    },
    { id: "r1", kind: "grocery", title: "milk", quantity: 1, list: null },
    { id: "r2", kind: "grocery", title: "eggs", quantity: 1, list: null },
  ],
  people: [{ kind: "account", id: "child-a", name: "Casey" }],
  lists: [],
  peopleOnEvents: true,
};

function reply(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  calls = [];
  available = true;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/ai/smart-add" && (!init?.method || init.method === "GET"))
      return reply({ available });
    if (url === "/api/ai/smart-add") return reply(draftReply);
    if (url === "/api/events") return reply({ event: { id: "e1" } });
    if (url === "/api/capture/grocery")
      return reply({ item: { id: `i${calls.length}` } });
    return reply({}, 404);
  }) as unknown as typeof fetch;
});

it("stays hidden when the server says smart Add is not available, or for a child", async () => {
  available = false;
  const { container, rerender } = render(<SmartAddBox role="parent" open />);
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(container).toBeEmptyDOMElement();
  rerender(<SmartAddBox role="child" open />);
  expect(container).toBeEmptyDOMElement();
});

it("shows drafts for review and saves nothing until the person confirms", async () => {
  const user = userEvent.setup();
  render(<SmartAddBox role="teen" open />);
  const box = await screen.findByRole("textbox", {
    name: /Type what you need/,
  });
  await user.type(box, "Dentist for Casey Tue 3:30, need milk and eggs");
  await user.click(screen.getByRole("button", { name: "Make drafts" }));
  const rows = await screen.findAllByTestId("smart-add-row");
  expect(rows).toHaveLength(3);
  const posted = JSON.parse(
    String(calls.find((c) => c.init?.method === "POST")?.init?.body),
  );
  expect(posted).toMatchObject({
    text: "Dentist for Casey Tue 3:30, need milk and eggs",
  });
  expect(Object.keys(posted).sort()).toEqual([
    "localDate",
    "localTime",
    "text",
    "timeZone",
  ]);
  expect(
    calls.some(
      (c) => c.url === "/api/events" || c.url === "/api/capture/grocery",
    ),
  ).toBe(false);

  // Remove one row, then add the rest.
  await user.click(within(rows[2]).getByRole("button", { name: /Remove/ }));
  expect(screen.getAllByTestId("smart-add-row")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Add all" }));
  await waitFor(() =>
    expect(
      calls.filter(
        (c) => c.url === "/api/events" || c.url === "/api/capture/grocery",
      ),
    ).toHaveLength(2),
  );
  const saves = calls.filter(
    (c) => c.url === "/api/events" || c.url === "/api/capture/grocery",
  );
  for (const save of saves)
    expect(
      (save.init?.headers as Record<string, string>)["Idempotency-Key"],
    ).toMatch(/.{16,}/);
  expect(JSON.parse(String(saves[0].init?.body))).toMatchObject({
    title: "Dentist",
    participants: [{ kind: "account", id: "child-a" }],
  });
  expect(await screen.findByText("Added 2.")).toBeInTheDocument();
  // Teens cannot delete household records, so no Undo is offered to them.
  expect(
    screen.queryByRole("button", { name: "Undo" }),
  ).not.toBeInTheDocument();
});

it("offers parents Undo through the ordinary delete routes", async () => {
  const user = userEvent.setup();
  render(<SmartAddBox role="parent" open />);
  await user.type(
    await screen.findByRole("textbox", { name: /Type what you need/ }),
    "milk",
  );
  await user.click(screen.getByRole("button", { name: "Make drafts" }));
  await screen.findAllByTestId("smart-add-row");
  await user.click(screen.getByRole("button", { name: "Add all" }));
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() =>
    expect(
      calls.some((c) => c.init?.method === "DELETE" && c.url === "/api/events"),
    ).toBe(true),
  );
  expect(
    calls.filter((c) => c.init?.method === "DELETE").map((c) => c.url),
  ).toEqual([
    "/api/events",
    expect.stringMatching(/^\/api\/lists\/items\//),
    expect.stringMatching(/^\/api\/lists\/items\//),
  ]);
});

it("falls back to the local comma split for groceries when offline", async () => {
  const user = userEvent.setup();
  render(<SmartAddBox role="parent" open />);
  const box = await screen.findByRole("textbox", {
    name: /Type what you need/,
  });
  const online = jest
    .spyOn(window.navigator, "onLine", "get")
    .mockReturnValue(false);
  await user.type(box, "milk, eggs, bread");
  await user.click(screen.getByRole("button", { name: "Make drafts" }));
  const rows = await screen.findAllByTestId("smart-add-row");
  expect(
    rows.map(
      (r) => (within(r).getByLabelText("Title") as HTMLInputElement).value,
    ),
  ).toEqual(["milk", "eggs", "bread"]);
  expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0);
  expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
  online.mockRestore();
});
