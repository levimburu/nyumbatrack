import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Same createPortal pattern used by every other modal in the app — keeps
// this immune to any parent wrapper breaking position:fixed.
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card-surface w-full max-w-sm p-6 animate-slide-up">
        <h2 className="font-display text-lg font-bold text-foreground mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-6">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-foreground"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all"
            style={{ background: danger ? "#DC2626" : "#166534" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
