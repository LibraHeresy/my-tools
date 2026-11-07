import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

export type ToastTone = "error" | "success" | "info";

export interface ToastData {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastProps {
  toast: ToastData;
  onClose: () => void;
}

const icons = {
  error: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

export function Toast({ toast, onClose }: ToastProps) {
  const Icon = icons[toast.tone];

  return (
    <div className={`toast toast-${toast.tone}`} role="status">
      <Icon size={17} />
      <span>{toast.message}</span>
      <button
        type="button"
        className="toast-close"
        aria-label="关闭提示"
        onClick={onClose}
      >
        <X size={14} />
      </button>
    </div>
  );
}
