import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Check,
  FileWarning,
  LoaderCircle,
} from "lucide-react";
import { GROUP_COLORS } from "../../lib/groupColors";
import { PageLightbox } from "./PageLightbox";
import { scheduleRender } from "./renderQueue";

export interface PreviewGroup {
  index: number;
  pages: number[];
  pageLabel: string;
  colorIndex: number;
}

interface PagePreviewProps {
  pdf: PDFDocumentProxy;
  pageCount: number;
  groups: PreviewGroup[] | null;
  footerText?: string;
  selectable?: boolean;
  selectedPages?: ReadonlySet<number>;
  onTogglePage?: (pageNumber: number) => void;
}

interface PageThumbnailProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  group: PreviewGroup | undefined;
  totalGroups: number;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpenPreview: () => void;
  onHoverPreview?: (pageNumber: number, rect: DOMRect) => void;
  onHoverEnd: () => void;
}

type RenderState = "idle" | "rendering" | "done" | "error";

function PageThumbnail({
  pdf,
  pageNumber,
  group,
  totalGroups,
  selectable,
  selected,
  onToggle,
  onOpenPreview,
  onHoverPreview,
  onHoverEnd,
}: PageThumbnailProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [renderState, setRenderState] = useState<RenderState>("idle");
  const [aspect, setAspect] = useState(1 / 1.414);

  const groupColor = group
    ? GROUP_COLORS[group.colorIndex % GROUP_COLORS.length]
    : "#ddd4c6";
  const borderColor = selected
    ? "#d84a2f"
    : totalGroups > 1
      ? groupColor
      : undefined;

  useEffect(() => {
    const node = frameRef.current;
    if (!node) {
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "320px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let disposed = false;
    let renderTask: { cancel: () => void } | null = null;

    setRenderState("rendering");

    void scheduleRender(async () => {
      if (disposed) {
        return;
      }

      const page = await pdf.getPage(pageNumber);
      if (disposed) {
        return;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const parentWidth = frameRef.current?.clientWidth || 160;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({
        scale: (parentWidth * dpr) / baseViewport.width,
      });
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      setAspect(baseViewport.width / baseViewport.height);

      renderTask = page.render({
        canvas,
        viewport,
        background: "#fffdf8",
      });
      await (
        renderTask as unknown as { promise: Promise<void> }
      ).promise;

      if (!disposed) {
        setRenderState("done");
      }
    }).catch((error: unknown) => {
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
  }, [pageNumber, pdf, visible]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  const clearHover = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    onHoverEnd();
  };

  const handleMouseEnter = () => {
    if (!onHoverPreview || renderState !== "done") {
      return;
    }

    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }

    hoverTimerRef.current = window.setTimeout(() => {
      const frame = frameRef.current;
      if (!frame) {
        return;
      }
      onHoverPreview(pageNumber, frame.getBoundingClientRect());
    }, 420);
  };

  const activate = () => {
    onOpenPreview();
  };

  const title = group
    ? `${group.pageLabel}，第 ${pageNumber} 页`
    : `第 ${pageNumber} 页`;

  return (
    <figure className="page-thumb" title={title}>
      <div
        ref={frameRef}
        className={`page-thumb-frame ${totalGroups > 1 ? "has-group" : ""} ${
          selectable ? "is-selectable" : ""
        } ${selected ? "is-selected" : ""}`}
        style={{
          aspectRatio: String(aspect),
          borderColor,
        }}
        role="button"
        tabIndex={0}
        aria-label={`查看第 ${pageNumber} 页大图`}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={clearHover}
      >
        <canvas
          ref={canvasRef}
          className="page-thumb-canvas"
          style={{ opacity: renderState === "done" ? 1 : 0 }}
        />
        {renderState !== "done" ? (
          <div className="page-thumb-placeholder">
            {renderState === "error" ? (
              <FileWarning size={18} />
            ) : (
              <LoaderCircle size={16} className="spin" />
            )}
          </div>
        ) : null}

        {selectable ? (
          <button
            type="button"
            className={`page-select-indicator ${selected ? "is-checked" : ""}`}
            aria-label={
              selected
                ? `取消选中第 ${pageNumber} 页`
                : `选中第 ${pageNumber} 页`
            }
            aria-pressed={selected}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {selected ? <Check size={11} strokeWidth={3} /> : null}
          </button>
        ) : null}

        <span
          className="page-thumb-number"
          style={{
            backgroundColor:
              totalGroups > 1 && !selectable
                ? `${groupColor}e6`
                : "rgba(34, 31, 26, 0.72)",
          }}
        >
          {pageNumber}
        </span>
      </div>
      <figcaption>
        <span>第 {pageNumber} 页</span>
        {selectable && selected ? (
          <span className="page-selected-label">已选</span>
        ) : totalGroups > 1 && group ? (
          <span className="page-group-label" style={{ color: groupColor }}>
            组 {group.index + 1}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

interface HoverPreview {
  pageNumber: number;
  left: number;
  top: number;
}

function HoverPageCanvas({
  pdf,
  pageNumber,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<RenderState>("rendering");

  useEffect(() => {
    let disposed = false;
    let renderTask: { cancel: () => void } | null = null;
    setState("rendering");

    void scheduleRender(async () => {
      if (disposed) {
        return;
      }
      const page = await pdf.getPage(pageNumber);
      if (disposed) {
        return;
      }
      const baseViewport = page.getViewport({ scale: 1 });
      const cssWidth = 438;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({
        scale: (cssWidth * dpr) / baseViewport.width,
      });
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      renderTask = page.render({
        canvas,
        viewport,
        background: "#fffdf8",
      });
      await (renderTask as unknown as { promise: Promise<void> }).promise;
      if (!disposed) {
        setState("done");
      }
    }).catch((error: unknown) => {
      if (
        !disposed &&
        !(error instanceof Error && error.name === "RenderingCancelledException")
      ) {
        setState("error");
      }
    });

    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdf]);

  return (
    <div className="page-hover-canvas-wrap">
      {state !== "done" ? (
        <div className="page-hover-placeholder">
          {state === "error" ? (
            <FileWarning size={20} />
          ) : (
            <LoaderCircle size={18} className="spin" />
          )}
        </div>
      ) : null}
      <canvas
        ref={canvasRef}
        className="page-hover-canvas"
        style={{ opacity: state === "done" ? 1 : 0 }}
      />
    </div>
  );
}

export function PagePreview({
  pdf,
  pageCount,
  groups,
  footerText = "拆分只复制页面，不改变原文件",
  selectable = false,
  selectedPages,
  onTogglePage,
}: PagePreviewProps) {
  const [lightboxPage, setLightboxPage] = useState<number | null>(null);
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);

  const clearHoverClose = () => {
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  };

  const scheduleHoverClose = () => {
    clearHoverClose();
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setHoverPreview(null);
      hoverCloseTimerRef.current = null;
    }, 0);
  };

  useEffect(() => {
    return () => clearHoverClose();
  }, []);

  const pageGroups = useMemo(() => {
    const map = new Map<number, PreviewGroup>();
    for (const group of groups ?? []) {
      for (const page of group.pages) {
        map.set(page, group);
      }
    }
    return map;
  }, [groups]);

  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );

  useEffect(() => {
    setLightboxPage(null);
    setHoverPreview(null);
    clearHoverClose();
  }, [pageCount, pdf]);

  useEffect(() => {
    const clearHover = () => {
      clearHoverClose();
      setHoverPreview(null);
    };
    window.addEventListener("scroll", clearHover, true);
    return () => window.removeEventListener("scroll", clearHover, true);
  }, []);

  const openPreview = (pageNumber: number) => {
    setHoverPreview(null);
    setLightboxPage(pageNumber);
  };

  const showHoverPreview = (pageNumber: number, rect: DOMRect) => {
    clearHoverClose();
    const width = 450;
    const maxHeight = Math.min(660, window.innerHeight - 32);
    const gap = 16;
    let left = rect.right + gap;
    if (left + width > window.innerWidth - 16) {
      left = rect.left - width - gap;
    }
    left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
    const top = Math.max(
      16,
      Math.min(rect.top, window.innerHeight - maxHeight - 16),
    );
    setHoverPreview({ pageNumber, left, top });
  };

  const selectedCount = selectedPages?.size ?? 0;

  return (
    <>
      <section
        className={`preview-panel ${pageCount >= 5 ? "is-wide" : ""}`}
        aria-labelledby="preview-title"
        style={
          {
            "--preview-columns": Math.min(Math.max(pageCount, 1), 5),
          } as CSSProperties
        }
      >
        <header className="preview-head">
          <div>
            <span className="panel-kicker">预览</span>
            <h2 id="preview-title">页面</h2>
          </div>
          <div className="preview-meta">
            <span>{pageCount} 页</span>
            {selectable ? (
              <>
                <span className="meta-dot" />
                <span className="selected-count-chip">
                  已选 {selectedCount} 页
                </span>
              </>
            ) : groups && groups.length > 1 ? (
              <>
                <span className="meta-dot" />
                <span>{groups.length} 个分组</span>
              </>
            ) : null}
          </div>
        </header>

        <div className="preview-scroll">
          <div className="page-grid">
            {pages.map((pageNumber) => (
              <PageThumbnail
                key={pageNumber}
                pdf={pdf}
                pageNumber={pageNumber}
                group={pageGroups.get(pageNumber)}
                totalGroups={groups?.length ?? 0}
                selectable={selectable}
                selected={selectedPages?.has(pageNumber) ?? false}
                onToggle={() => onTogglePage?.(pageNumber)}
                onOpenPreview={() => openPreview(pageNumber)}
                onHoverPreview={showHoverPreview}
                onHoverEnd={scheduleHoverClose}
              />
            ))}
          </div>
        </div>

        <footer className="preview-foot">
          <span className="preview-foot-dot" />
          <span>
            {selectable
              ? "点击页面查看大图；点击左上角选择"
              : footerText}
          </span>
        </footer>
      </section>

      {hoverPreview
        ? createPortal(
            <div
              className="page-hover-preview"
              style={{ left: hoverPreview.left, top: hoverPreview.top }}
              onMouseEnter={clearHoverClose}
              onMouseLeave={scheduleHoverClose}
              onClick={() => openPreview(hoverPreview.pageNumber)}
              role="group"
              aria-label={`第 ${hoverPreview.pageNumber} 页预览`}
            >
              <HoverPageCanvas pdf={pdf} pageNumber={hoverPreview.pageNumber} />
              {selectable ? (
                <button
                  type="button"
                  className={`page-hover-select ${
                    selectedPages?.has(hoverPreview.pageNumber)
                      ? "is-checked"
                      : ""
                  }`}
                  aria-label={
                    selectedPages?.has(hoverPreview.pageNumber)
                      ? `取消选中第 ${hoverPreview.pageNumber} 页`
                      : `选中第 ${hoverPreview.pageNumber} 页`
                  }
                  aria-pressed={selectedPages?.has(hoverPreview.pageNumber)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePage?.(hoverPreview.pageNumber);
                  }}
                >
                  {selectedPages?.has(hoverPreview.pageNumber) ? (
                    <Check size={14} strokeWidth={3} />
                  ) : null}
                </button>
              ) : null}
              <span className="page-hover-label">
                第 {hoverPreview.pageNumber} 页
              </span>
            </div>,
            document.body,
          )
        : null}

      {lightboxPage !== null
        ? createPortal(
            <PageLightbox
              pdf={pdf}
              initialPage={lightboxPage}
              pageCount={pageCount}
              onClose={() => setLightboxPage(null)}
              selectable={selectable}
              selectedPages={selectedPages}
              onTogglePage={onTogglePage}
            />,
            document.body,
          )
        : null}
    </>
  );
}
