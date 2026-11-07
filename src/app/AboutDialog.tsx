import { useEffect, useRef } from "react";
import { RefreshCw, ShieldCheck, X } from "lucide-react";

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  onCheckUpdate: () => void;
}

export function AboutDialog({ open, onClose, onCheckUpdate }: AboutDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
      >
        <button
          ref={closeButtonRef}
          type="button"
          className="icon-button modal-close"
          aria-label="关闭关于窗口"
          onClick={onClose}
        >
          <X size={18} />
        </button>

        <div className="about-head">
          <img src="/app-icon.png" alt="" className="about-icon" />
          <div>
            <span className="eyebrow">本地工具台</span>
            <h2 id="about-title">PDF 工具台</h2>
            <p>版本 0.8.0 · Windows 桌面版</p>
          </div>
        </div>

        <p className="about-lead">
          一个轻量的本地小工具。没有账号，没有上传，也不会把文件发到网络。
        </p>

        <div className="about-grid">
          <div>
            <span>处理方式</span>
            <strong>
              <ShieldCheck size={15} />
              完全本地
            </strong>
          </div>
          <div>
            <span>当前能力</span>
            <strong>PDF 拆分 · 精灵图切图 · 合成图集 · 图片转 PNG</strong>
          </div>
          <div>
            <span>应用框架</span>
            <strong>Tauri 2 + React</strong>
          </div>
          <div>
            <span>处理引擎</span>
            <strong>PDF.js + pdf-lib + Rust</strong>
          </div>
        </div>

        <div className="about-note">
          后续会沿用工具注册表继续加入合并、提取页面、压缩等工具，所有工具共享同一套本地文件处理能力。
        </div>

        <div className="about-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCheckUpdate}
          >
            <RefreshCw size={15} />
            检查更新
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
