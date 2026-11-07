import { FileUp, LoaderCircle, LockKeyhole } from "lucide-react";

interface DropzoneProps {
  busy: boolean;
  onPick: () => void;
}

export function Dropzone({ busy, onPick }: DropzoneProps) {
  return (
    <section className="dropzone" aria-labelledby="dropzone-title">
      <div className="drop-art" aria-hidden="true">
        <div className="drop-sheet drop-sheet-back" />
        <div className="drop-sheet drop-sheet-left">
          <span />
          <span />
          <span />
        </div>
        <div className="drop-sheet drop-sheet-right">
          <span />
          <span />
          <span />
        </div>
        <div className="drop-cut-line" />
      </div>

      <div className="drop-copy">
        <div className="eyebrow">PDF 拆分</div>
        <h2 id="dropzone-title">把 PDF 拖进来</h2>
        <p>按范围、页数或单页拆分。也可以从电脑里选择一个文件。</p>
      </div>

      <button
        type="button"
        className="btn btn-primary drop-button"
        onClick={onPick}
        disabled={busy}
      >
        {busy ? (
          <>
            <LoaderCircle size={18} className="spin" />
            正在读取 PDF…
          </>
        ) : (
          <>
            <FileUp size={18} />
            选择 PDF 文件
          </>
        )}
      </button>

      <div className="drop-hints">
        <span>
          <LockKeyhole size={13} />
          文件不会上传
        </span>
        <span className="hint-dot" />
        <span>只支持单个 PDF</span>
        <span className="hint-dot" />
        <span>加密 PDF 暂不支持</span>
      </div>
    </section>
  );
}
