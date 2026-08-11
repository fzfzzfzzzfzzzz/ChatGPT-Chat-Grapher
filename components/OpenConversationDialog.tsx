import type { ConversationOpenMode } from "../shared/messages";
import { Modal } from "./Modal";

type Props = {
  question: string;
  busy?: boolean;
  onChoose: (mode: ConversationOpenMode) => void;
  onClose: () => void;
};

export function OpenConversationDialog({ question, busy, onChoose, onClose }: Props) {
  return (
    <Modal
      title="原会话尚未打开"
      description="请选择如何打开，然后插件会继续定位原问题。"
      onClose={busy ? () => undefined : onClose}
      footer={
        <div className="open-conversation-actions">
          <button className="button" type="button" disabled={busy} onClick={onClose}>取消</button>
          <button className="button" type="button" disabled={busy} onClick={() => onChoose("current_tab")}>当前页打开</button>
          <button className="button button--primary" type="button" disabled={busy} onClick={() => onChoose("new_tab")}>
            {busy ? "正在打开…" : "新标签页打开"}
          </button>
        </div>
      }
    >
      <div className="question-readonly">
        <span>目标问题</span>
        <p>{question}</p>
      </div>
    </Modal>
  );
}
