import { AlertTriangle, Crosshair } from "lucide-react";
import { Modal } from "./Modal";

type Props = {
  title: string;
  body: string;
  confirmLabel?: string;
  intent?: "danger" | "primary";
  onConfirm: () => Promise<void>;
  onClose: () => void;
};

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "确认删除",
  intent = "danger",
  onConfirm,
  onClose,
}: Props) {
  const Icon = intent === "danger" ? AlertTriangle : Crosshair;
  return (
    <Modal title={title} onClose={onClose}>
      <div className={`confirm-copy confirm-copy--${intent}`}>
        <Icon size={22} aria-hidden="true" />
        <p>{body}</p>
      </div>
      <div className="form-actions">
        <button className="button" type="button" onClick={onClose}>
          取消
        </button>
        <button className={`button button--${intent}`} type="button" onClick={() => void onConfirm()}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
