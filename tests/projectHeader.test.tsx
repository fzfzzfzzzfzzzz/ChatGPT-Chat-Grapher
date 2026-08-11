// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectHeader } from "../components/ProjectHeader";

describe("ProjectHeader", () => {
  afterEach(cleanup);

  it("always exposes the page floating-panel entry", async () => {
    const onOpenFloatingPanel = vi.fn();
    render(
      <ProjectHeader
        projects={[]}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onOpenFloatingPanel={onOpenFloatingPanel}
        onSettings={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "打开页面浮窗" }));
    expect(onOpenFloatingPanel).toHaveBeenCalledOnce();
  });
});
