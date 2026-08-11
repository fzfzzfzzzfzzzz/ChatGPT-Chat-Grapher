// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataBackupSection } from "../components/DataBackupSection";

describe("DataBackupSection", () => {
  afterEach(cleanup);

  it("exports and imports JSON backups with visible completion feedback", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn().mockResolvedValue({
      projectCount: 2,
      nodeCount: 7,
      candidateCount: 1,
    });
    const onImport = vi.fn().mockResolvedValue({
      projectCount: 1,
      nodeCount: 3,
      candidateCount: 0,
      eventCount: 0,
      importedProjectIds: ["project-imported"],
    });
    render(<DataBackupSection onExport={onExport} onImport={onImport} />);

    await user.click(screen.getByRole("button", { name: "导出 JSON" }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(await screen.findByText("已导出 2 个项目、7 个问题节点。")).toBeTruthy();

    const file = new File(["{}"], "chat-graph-backup.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("选择 Chat Graph JSON 备份"), file);
    expect(onImport).toHaveBeenCalledWith(file);
    expect(await screen.findByText("已导入 1 个项目、3 个问题节点。")).toBeTruthy();
  });

  it("keeps import errors inside the settings dialog", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn().mockRejectedValue(new Error("这不是 Chat Graph 备份文件。"));
    render(
      <DataBackupSection
        onExport={vi.fn()}
        onImport={onImport}
      />,
    );

    await user.upload(
      screen.getByLabelText("选择 Chat Graph JSON 备份"),
      new File(["{}"], "wrong.json", { type: "application/json" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain("这不是 Chat Graph 备份文件。");
  });
});
