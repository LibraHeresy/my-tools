import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  LoaderCircle,
  X,
} from "lucide-react";

interface PageLightboxProps {
  pdf: PDFDocumentProxy;
  initialPage: number;
  pageCount: number;
  onClose: () => void;
  selectable?: boolean;
  selectedPages?: ReadonlySet<number>;
  onTogglePage?: (pageNumber: number) => void;
}

type RenderState = "rendering" | "done" | "error";

export function PageLightbox({
  pdf,
  initialPage,
  pageCount,
  onClose,
  selectable = false,
  selectedPages,
  onTogglePage,
}: PageLightboxProps) {
  const [pageNumber, setPageNumber] = useState(initialPage);
  const [renderState, setRenderState] = useState<RenderState>("rendering");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const selected = selectedPages?.has(pageNumber) ?? false;

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPageNumber((current) => Math.max(1, current - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPageNumber((current) => Math.min(pageCount, current + 1));
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, pageCount]);

  useEffect(() => {
    let disposed = false;
    let renderTask: { cancel: () => void } | null = null;

    setRenderState("rendering");

    void pdf
      .getPage(pageNumber)
      .then((page) => {
        if (disposed) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const maxWidth = Math.min(window.innerWidth * 0.78, 900);
        const maxHeight = window.innerHeight * 0.72;
        const cssScale = Math.min(
          maxWidth / baseViewport.width,
          maxHeight / baseViewport.height,
        );
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * dpr });
        const canvas = canvasRef.current;

        if (!canvas) {
          return;
        }

        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        renderTask = page.render({
          canvas,
          viewport,
          background: "#fffdf8",
        });
        return (renderTask as unknown as { promise: Promise<void> }).promise;
      })
      .then(() => {
        if (!disposed) {
          setRenderState("done");
        }
      })
      .catch((error: unknown) => {
        if (
          !disposed &&
          !(
            error instanceof Error &&
            error.name === "RenderingCancelledException"
          )
        ) {
          setRenderState("error");
        }
      });

    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdf]);

  return (
    <div
      className="page-lightbox-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="page-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lightbox-title"
      >
        <header className="page-lightbox-head">
          <div>
            <span className="panel-kicker">大图预览</span>
            <h2 id="lightbox-title">第 {pageNumber} 页</h2>
          </div>
          <div className="page-lightbox-head-actions">
            {selectable ? (
              <button
                type="button"
                className={`page-lightbox-select ${selected ? "is-checked" : ""}`}
                aria-pressed={selected}
                onClick={() => onTogglePage?.(pageNumber)}
              >
                {selected ? <Check size={14} strokeWidth={3} /> : null}
                {selected ? "已选中" : "选中此页"}
              </button>
            ) : null}
            <span className="page-lightbox-count">
              {pageNumber} / {pageCount}
            </span>
            <button
              ref={closeRef}
              type="button"
              className="icon-button"
              aria-label="关闭大图预览"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="page-lightbox-stage">
          <button
            type="button"
            className="page-lightbox-nav"
            aria-label="上一页"
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            disabled={pageNumber === 1}
          >
            <ChevronLeft size={22} />
          </button>

          <div className="page-lightbox-canvas-wrap">
            {renderState !== "done" ? (
              <div className="page-lightbox-placeholder">
                {renderState === "error" ? (
                  <FileWarning size={24} />
                ) : (
                  <LoaderCircle size={22} className="spin" />
                )}
              </div>
            ) : null}
            <canvas
              ref={canvasRef}
              className="page-lightbox-canvas"
              style={{ opacity: renderState === "done" ? 1 : 0 }}
            />
          </div>

          <button
            type="button"
            className="page-lightbox-nav"
            aria-label="下一页"
            onClick={() =>
              setPageNumber((current) => Math.min(pageCount, current + 1))
            }
            disabled={pageNumber === pageCount}
          >
            <ChevronRight size={22} />
          </button>
        </div>

        <footer className="page-lightbox-foot">
          <span>← → 切换页面</span>
          <span>Esc 关闭</span>
        </footer>
      </div>
    </div>
  );
}
