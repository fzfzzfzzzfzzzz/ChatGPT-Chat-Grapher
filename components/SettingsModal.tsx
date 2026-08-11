import { useState, type FormEvent } from "react";
import type { AISettings } from "../types/domain";
import { Modal } from "./Modal";

type Props = {
  ai: AISettings;
  onSave: (ai: AISettings) => Promise<void>;
  onClose: () => void;
};

export function SettingsModal({ ai, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(ai);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="父节点推荐设置"
      description="AI 只接收新问题、简短摘要和有限候选节点；API Key 仅保存在本机。"
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          启用百炼父节点推荐
        </label>
        <label>
          百炼 API Key
          <input
            type="password"
            autoComplete="off"
            value={draft.apiKey}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            placeholder="sk-…"
          />
        </label>
        <label>
          Base URL
          <input
            type="url"
            value={draft.baseUrl}
            onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            Model ID
            <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
          </label>
          <label>
            Timeout (ms)
            <input
              type="number"
              min={5_000}
              max={120_000}
              value={draft.timeoutMs}
              onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) || 30_000 })}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            自动连接阈值
            <input
              type="number"
              min="0.6"
              max="1"
              step="0.01"
              value={draft.highConfidence}
              onChange={(event) => setDraft({ ...draft, highConfidence: Number(event.target.value) })}
            />
          </label>
          <label>
            候选提示阈值
            <input
              type="number"
              min="0"
              max="0.85"
              step="0.01"
              value={draft.mediumConfidence}
              onChange={(event) => setDraft({ ...draft, mediumConfidence: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="button" type="button" onClick={onClose}>取消</button>
          <button className="button button--primary" type="submit" disabled={saving}>
            {saving ? "保存中…" : "保存设置"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
