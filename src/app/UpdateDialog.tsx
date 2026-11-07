import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import type {
  AvailableUpdate,
  DownloadProgress,
  UpdatePhase,
} from "./useUpdater";

interface UpdateDialogProps {
  open: boolean;
  phase: UpdatePhase;
  update: AvailableUpdate | null;
  progress: DownloadProgress;
  error: string | null;
  onInstall: () => void;
  onRetry: () => void;
  onClose: () => void;
}

export function UpdateDialog({
  open,
  phase,
  update,
  progress,
  error,
  onInstall,
  onRetry,
  onClose,
}: UpdateDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const downloading = phase === "downloading";
  const percent =
    progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : 0;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
  }, [open]);

  if (!open) {
    return null;
  }

  const title =
    phase === "checking"
      ? "正在检查更新"
      : phase === "available"
        ? "发现新版本"
        : phase === "downloading"
          ? "正在下载更新"
          : phase === "ready"
            ? "更新已准备"
            : phase === "uptodate"
              ? "已是最新版本"
              : "检查更新失败";

  return (
    <div
      className="update-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !downloading) {
          onClose();
        }
      }}
    >
      <section
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
      >
        <header className="update-dialog-head">
          <span
            className={`update-dialog-icon ${
              phase === "error"
                ? "is-error"
                : phase === "available" || phase === "ready"
                  ? "is-ready"
                  : ""
            }`}
          >
            {phase === "checking" || phase === "downloading" ? (
              <LoaderCircle size={19} className="spin" />
            ) : phase === "available" ? (
              <Download size={19} />
            ) : phase === "ready" || phase === "uptodate" ? (
              <CheckCircle2 size={19} />
            ) : (
              <AlertTriangle size={19} />
            )}
          </span>
          <div className="update-dialog-title">
            <span className="panel-kicker">自动更新</span>
            <h2 id="update-title">{title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label="关闭更新窗口"
            onClick={onClose}
            disabled={downloading}
          >
            <X size={17} />
          </button>
        </header>

        {phase === "available" && update ? (
          <>
            <p className="update-version">
              当前版本 <strong>v{update.currentVersion}</strong>
              <span>→</span>
              新版本 <strong>v{update.version}</strong>
            </p>
            {update.date ? (
              <span className="update-date">
                发布于 {new Date(update.date).toLocaleDateString("zh-CN")}
              </span>
            ) : null}
            <div className="update-notes">
              {update.body?.trim() || "这个版本暂无更新说明。"}
            </div>
            <div className="update-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                稍后
              </button>
              <button type="button" className="btn btn-primary" onClick={onInstall}>
                <Download size={16} />
                下载并安装
              </button>
            </div>
          </>
        ) : phase === "downloading" ? (
          <>
            <p className="update-message">
              正在下载 v{update?.version ?? ""}，下载完成后会自动启动安装程序。
            </p>
            <div className="update-progress">
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="update-progress-meta">
              <span>{percent}%</span>
              <span>
                {progress.total > 0
                  ? `${(progress.downloaded / 1024 / 1024).toFixed(1)} / ${(
                      progress.total /
                      1024 /
                      1024
                    ).toFixed(1)} MB`
                  : `${(progress.downloaded / 1024 / 1024).toFixed(1)} MB`}
              </span>
            </div>
            <p className="update-hint">下载过程中请保持应用开启。</p>
          </>
        ) : phase === "ready" ? (
          <>
            <p className="update-message">
              更新包已下载，安装程序已经启动。应用可能会自动关闭并重新打开。
            </p>
            <div className="update-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                关闭
              </button>
            </div>
          </>
        ) : phase === "uptodate" ? (
          <>
            <p className="update-message">当前已经是最新版本。</p>
            <div className="update-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                知道了
              </button>
            </div>
          </>
        ) : phase === "error" ? (
          <>
            <p className="update-message is-error">{error ?? "检查更新失败，请稍后重试。"}</p>
            <div className="update-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                关闭
              </button>
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                <RefreshCw size={16} />
                重试
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="update-message">正在连接 GitHub Releases，请稍候。</p>
            <div className="update-progress is-indeterminate">
              <span />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
