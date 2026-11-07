import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileText,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import { openFolder } from "../../../lib/platform";
import { truncateMiddle } from "../../../lib/format";

export interface ResultFile {
  fileName: string;
  pageLabel: string;
  pageCount: number;
  path: string;
}

export interface SplitResult {
  files: ResultFile[];
  directory: string;
  isDesktop: boolean;
  pageCount: number;
}

interface ResultViewProps {
  result: SplitResult;
  onAgain: () => void;
  onHome: () => void;
}

export function ResultView({ result, onAgain, onHome }: ResultViewProps) {
  const [openError, setOpenError] = useState<string | null>(null);
  const visibleFiles = result.files.slice(0, 6);
  const hiddenCount = result.files.length - visibleFiles.length;

  const handleOpenFolder = async () => {
    setOpenError(null);
    try {
      await openFolder(result.directory);
    } catch {
      setOpenError("无法打开输出文件夹，请手动前往保存位置。");
    }
  };

  return (
    <div className="result-view page-enter">
      <div className="result-panel">
        <div className="result-mark" aria-hidden="true">
          <Check size={26} strokeWidth={2.4} />
        </div>

        <div className="eyebrow centered">完成</div>
        <h1>拆分完成</h1>
        <p className="result-lead">
          已生成 {result.files.length} 个 PDF，原文件没有被修改。
        </p>

        <div className="result-stats">
          <div>
            <span>输出文件</span>
            <strong>{result.files.length}</strong>
          </div>
          <div>
            <span>源文件页数</span>
            <strong>{result.pageCount}</strong>
          </div>
          <div className="result-location-stat">
            <span>保存位置</span>
            <strong title={result.directory}>
              {result.isDesktop
                ? truncateMiddle(result.directory, 28)
                : "浏览器下载目录"}
            </strong>
          </div>
        </div>

        <div className="result-files">
          <div className="result-files-head">
            <span>生成的文件</span>
            <span>{result.files.length} 个</span>
          </div>
          <ul>
            {visibleFiles.map((file) => (
              <li key={file.path || file.fileName}>
                <span className="result-file-icon">
                  <FileText size={15} />
                </span>
                <span className="result-file-name" title={file.path}>
                  {file.fileName}
                </span>
                <span className="result-file-pages">{file.pageCount} 页</span>
              </li>
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <p className="plan-more">另有 {hiddenCount} 个文件未展开显示</p>
          ) : null}
        </div>

        {openError ? (
          <div className="inline-alert" role="alert">
            <AlertTriangle size={16} />
            <span>{openError}</span>
          </div>
        ) : null}

        <div className="result-actions">
          {result.isDesktop ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleOpenFolder()}
            >
              <FolderOpen size={17} />
              打开文件夹
            </button>
          ) : null}
          <button
            type="button"
            className={`btn ${result.isDesktop ? "btn-secondary" : "btn-primary"}`}
            onClick={onAgain}
          >
            <RotateCcw size={16} />
            继续拆分
          </button>
          <button type="button" className="btn btn-ghost" onClick={onHome}>
            <ArrowLeft size={16} />
            返回工具列表
          </button>
        </div>

        <p className="result-footnote">
          所有处理都在这台电脑上完成，文件没有离开过本机。
        </p>
      </div>
    </div>
  );
}
