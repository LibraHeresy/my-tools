import { FileText, RefreshCw, ShieldCheck } from "lucide-react";
import { formatBytes, truncateMiddle } from "../../lib/format";

interface FileBarProps {
  name: string;
  path: string;
  size: number;
  pageCount: number;
  disabled: boolean;
  onReplace: () => void;
}

export function FileBar({
  name,
  path,
  size,
  pageCount,
  disabled,
  onReplace,
}: FileBarProps) {
  return (
    <div className="file-bar">
      <div className="file-main">
        <div className="file-icon">
          <FileText size={22} />
        </div>
        <div className="file-copy">
          <div className="file-title-row">
            <h2 title={name}>{name}</h2>
            <span className="file-local">
              <ShieldCheck size={12} />
              本地
            </span>
          </div>
          <div className="file-meta">
            <span>{pageCount} 页</span>
            <span className="meta-dot" />
            <span>{formatBytes(size)}</span>
            {path ? (
              <>
                <span className="meta-dot" />
                <span className="file-path" title={path}>
                  {truncateMiddle(path, 46)}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-ghost btn-compact"
        onClick={onReplace}
        disabled={disabled}
      >
        <RefreshCw size={15} />
        更换文件
      </button>
    </div>
  );
}
