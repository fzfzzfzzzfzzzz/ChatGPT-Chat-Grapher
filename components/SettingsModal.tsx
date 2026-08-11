import { useEffect, useId, useState, type FormEvent } from "react";
import { CheckCircle2, CircleAlert, LoaderCircle } from "lucide-react";
import {
  AI_PROVIDERS,
  getAIProviderDefinition,
  getAIProviderProfile,
} from "../ai/providers";
import type { TestAIProviderResponse } from "../shared/messages";
import type { BackupImportResult, BackupSummary } from "../db/backup";
import type { AIProviderProfile, AISettings } from "../types/domain";
import { DataBackupSection } from "./DataBackupSection";
import { Modal } from "./Modal";

type Props = {
  ai: AISettings;
  onSave: (ai: AISettings) => Promise<void>;
  onTest: (ai: AISettings) => Promise<TestAIProviderResponse>;
  onCheckPermission: (ai: AISettings) => Promise<boolean>;
  onExportData: () => Promise<BackupSummary>;
  onImportData: (file: File) => Promise<BackupImportResult>;
  onClose: () => void;
};

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

export function SettingsModal({
  ai,
  onSave,
  onTest,
  onCheckPermission,
  onExportData,
  onImportData,
  onClose,
}: Props) {
  const [draft, setDraft] = useState(ai);
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const [permissionGranted, setPermissionGranted] = useState<boolean>();
  const modelListId = useId();
  const provider = getAIProviderDefinition(draft.activeProvider);
  const profile = getAIProviderProfile(draft.profiles, draft.activeProvider);

  useEffect(() => {
    let cancelled = false;
    setPermissionGranted(undefined);
    void onCheckPermission(draft).then((granted) => {
      if (!cancelled) setPermissionGranted(granted);
    });
    return () => {
      cancelled = true;
    };
  }, [draft.activeProvider, profile.baseUrl, onCheckPermission]);

  function updateProfile(patch: Partial<AIProviderProfile>) {
    setDraft((current) => ({
      ...current,
      profiles: {
        ...current.profiles,
        [current.activeProvider]: {
          ...getAIProviderProfile(current.profiles, current.activeProvider),
          ...patch,
        },
      },
    }));
    setTestState({ status: "idle" });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setTestState({ status: "idle" });
    try {
      await onSave(draft);
    } catch (error) {
      setTestState({
        status: "error",
        message: error instanceof Error ? error.message : "设置保存失败。",
      });
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTestState({ status: "testing" });
    try {
      const result = await onTest(draft);
      if (result.ok) {
        setPermissionGranted(true);
        setTestState({ status: "success", message: `${provider.label} 连接成功，模型 ${result.model} 返回了有效推荐。` });
      } else {
        setTestState({ status: "error", message: result.error });
      }
    } catch (error) {
      setTestState({
        status: "error",
        message: error instanceof Error ? error.message : "AI 连接测试失败。",
      });
    }
  }

  return (
    <Modal
      title="设置"
      description="管理 AI 父节点推荐与本地数据备份。"
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <div className="settings-section__header">
          <div>
            <h3>AI 父节点推荐</h3>
            <p>API Key 仅保存在本机，请求直接发送到所选厂商。</p>
          </div>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          />
          启用 AI 父节点推荐
        </label>
        <label>
          API 厂商
          <select
            value={draft.activeProvider}
            onChange={(event) => {
              setDraft({ ...draft, activeProvider: event.target.value as AISettings["activeProvider"] });
              setTestState({ status: "idle" });
            }}
          >
            {AI_PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <div className="provider-card">
          <div>
            <strong>{provider.label}</strong>
            <span>{provider.transport === "anthropic-messages" ? "Anthropic Messages" : "OpenAI Chat Completions"}</span>
          </div>
          <span className={`provider-permission ${permissionGranted ? "is-granted" : ""}`}>
            {permissionGranted === undefined ? "检查授权中…" : permissionGranted ? "域名已授权" : "域名未授权"}
          </span>
        </div>
        <label>
          {provider.label} API Key
          <input
            type="password"
            autoComplete="off"
            value={profile.apiKey}
            onChange={(event) => updateProfile({ apiKey: event.target.value })}
            placeholder="sk-…"
          />
        </label>
        <label>
          Base URL
          <input
            type="url"
            value={profile.baseUrl}
            readOnly={!provider.editableBaseUrl}
            aria-readonly={!provider.editableBaseUrl}
            onChange={(event) => updateProfile({ baseUrl: event.target.value })}
            placeholder={provider.editableBaseUrl ? "https://api.example.com/v1" : undefined}
          />
          <small>{provider.editableBaseUrl ? "仅支持 HTTPS；保存或测试时只申请该域名。" : "官方 API 地址固定为只读。"}</small>
        </label>
        <div className="form-grid">
          <label>
            Model ID
            <input
              list={modelListId}
              value={profile.model}
              onChange={(event) => updateProfile({ model: event.target.value })}
              placeholder={provider.editableBaseUrl ? "输入兼容服务的模型 ID" : undefined}
            />
            <datalist id={modelListId}>
              {provider.suggestedModels.map((model) => <option key={model} value={model} />)}
            </datalist>
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
        <div className="provider-test-row">
          <div>
            <strong>连接测试</strong>
            <span>会发送一次最小父节点推荐请求，可能产生极少量费用。</span>
          </div>
          <button
            className="button"
            type="button"
            disabled={saving || testState.status === "testing"}
            onClick={() => void runTest()}
          >
            {testState.status === "testing" ? <LoaderCircle className="spin" size={13} /> : null}
            {testState.status === "testing" ? "测试中…" : "测试连接"}
          </button>
        </div>
        {testState.status === "success" ? (
          <div className="provider-feedback is-success" role="status">
            <CheckCircle2 size={14} /> <span>{testState.message}</span>
          </div>
        ) : null}
        {testState.status === "error" ? (
          <div className="provider-feedback is-error" role="alert">
            <CircleAlert size={14} /> <span>{testState.message}</span>
          </div>
        ) : null}
        <DataBackupSection onExport={onExportData} onImport={onImportData} />
        <div className="form-actions">
          <button className="button" type="button" onClick={onClose}>取消</button>
          <button className="button button--primary" type="submit" disabled={saving || testState.status === "testing"}>
            {saving ? "保存中…" : "保存设置"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
