import { useRef, useState, type ChangeEvent } from "react";
import { CheckCircle2, CircleAlert, Download, LoaderCircle, Upload } from "lucide-react";
import type { BackupImportResult, BackupSummary } from "../db/backup";

type Props = {
  onExport: () => Promise<BackupSummary>;
  onImport: (file: File) => Promise<BackupImportResult>;
};

type ActionState =
  | { status: "idle" }
  | { status: "exporting" | "importing" }
  | { status: "success" | "error"; message: string };

export function DataBackupSection({ onExport, onImport }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const busy = action.status === "exporting" || action.status === "importing";

  async function exportData() {
    setAction({ status: "exporting" });
    try {
      const result = await onExport();
      setAction({
        status: "success",
        message: `已导出 ${result.projectCount} 个项目、${result.nodeCount} 个问题节点、${result.reviewDocumentCount} 份总结（${result.reviewVersionCount} 个版本）。`,
      });
    } catch (error) {
      setAction({ status: "error", message: messageFromError(error, "导出失败，请重试。") });
    }
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setAction({ status: "importing" });
    try {
      const result = await onImport(file);
      setAction({
        status: "success",
        message: `已导入 ${result.projectCount} 个项目、${result.nodeCount} 个问题节点、${result.reviewDocumentCount} 份总结（${result.reviewVersionCount} 个版本）。`,
      });
    } catch (error) {
      setAction({ status: "error", message: messageFromError(error, "导入失败，请检查备份文件。") });
    }
  }

  return (
    <section className="settings-section" aria-labelledby="data-backup-title">
      <div className="settings-section__header">
        <div>
          <h3 id="data-backup-title">本地数据备份</h3>
          <p>导出全部项目数据；导入会创建新的项目副本。</p>
        </div>
      </div>
      <div className="data-backup-actions">
        <button className="button" type="button" disabled={busy} onClick={() => void exportData()}>
          {action.status === "exporting" ? <LoaderCircle className="spin" size={13} /> : <Download size={13} />}
          {action.status === "exporting" ? "导出中…" : "导出 JSON"}
        </button>
        <button
          className="button"
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {action.status === "importing" ? <LoaderCircle className="spin" size={13} /> : <Upload size={13} />}
          {action.status === "importing" ? "导入中…" : "导入 JSON"}
        </button>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".json,application/json"
          aria-label="选择 Chat Graph JSON 备份"
          disabled={busy}
          onChange={(event) => void importData(event)}
        />
      </div>
      <p className="data-backup-note">备份包含问题图、总结及版本、消息定位和轻量引用信息（可能含缩略图、回答短摘录与最长 240 字的总结证据），不包含完整对话原文、AI 设置或 API Key。</p>
      {action.status === "success" ? (
        <div className="provider-feedback is-success" role="status">
          <CheckCircle2 size={14} /> <span>{action.message}</span>
        </div>
      ) : null}
      {action.status === "error" ? (
        <div className="provider-feedback is-error" role="alert">
          <CircleAlert size={14} /> <span>{action.message}</span>
        </div>
      ) : null}
    </section>
  );
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
