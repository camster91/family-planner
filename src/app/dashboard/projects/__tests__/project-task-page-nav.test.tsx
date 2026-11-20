/**
 * @jest-environment jsdom
 */
// Project task paging: no developer text such as "Showing 3 tasks on this
// page; Open and Done below refer to this page." Only real problems get a line.
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { ProjectTaskPageNav } from "../[id]/ProjectTaskPageNav";

jest.mock("@/components/layout/owned-draft-navigation", () => ({
  useDraftAwareRouter: () => ({ push: jest.fn(async () => true) }),
}));

describe("ProjectTaskPageNav", () => {
  it("shows no paging line on an ordinary task page", () => {
    render(
      <ProjectTaskPageNav projectId="p1" loaded={3} total={3} nextCursor={null} paged={false} invalid={false} />,
    );
    expect(screen.queryByText(/on this page/i)).toBeNull();
    expect(screen.queryByText(/Showing/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("still offers More tasks when there are more, without a count line", () => {
    render(
      <ProjectTaskPageNav projectId="p1" loaded={50} total={80} nextCursor="c2" paged={false} invalid={false} />,
    );
    expect(screen.getByRole("link", { name: "More tasks" })).toBeTruthy();
    expect(screen.queryByText(/50/)).toBeNull();
  });

  it("keeps the real problem lines", () => {
    const view = render(
      <ProjectTaskPageNav projectId="p1" loaded={0} total={4} nextCursor={null} paged invalid={false} />,
    );
    expect(screen.getByText(/No tasks remain/)).toBeTruthy();
    view.unmount();
    render(
      <ProjectTaskPageNav projectId="p1" loaded={0} total={4} nextCursor={null} paged={false} invalid />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
