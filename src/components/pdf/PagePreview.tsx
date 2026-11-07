import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Check,
  FileWarning,
  LoaderCircle,
  Maximize2,
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
  onHoverPreview?: (source: string, rect: DOMRect) => void;
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
      const canvas = canvasRef.current;
      const frame = frameRef.current;
      if (!canvas || !frame) {
        return;
      }
      try {
        onHoverPreview(canvas.toDataURL("image/png"), frame.getBoundingClientRect());
      } catch {
        // Tainted canvas is not expected here; hover preview is optional.
      }
    }, 420);
  };

  const activate = () => {
    if (selectable) {
      onToggle();
    } else {
      onOpenPreview();
    }
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
        role={selectable ? "checkbox" : "button"}
        tabIndex={0}
        aria-checked={selectable ? selected : undefined}
        aria-label={
          selectable
            ? `第 ${pageNumber} 页，${selected ? "已选中" : "未选中"}`
            : `查看第 ${pageNumber} 页大图`
        }
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
          <span
            className={`page-select-indicator ${selected ? "is-checked" : ""}`}
            aria-hidden="true"
          >
            {selected ? <Check size={11} strokeWidth={3} /> : null}
          </span>
        ) : null}

        <button
          type="button"
          className="page-zoom-button"
          aria-label={`查看第 ${pageNumber} 页大图`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenPreview();
          }}
        >
          <Maximize2 size={12} />
        </button>

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
  source: string;
  left: number;
  top: number;
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
  }, [pageCount, pdf]);

  useEffect(() => {
    const clearHover = () => setHoverPreview(null);
    window.addEventListener("scroll", clearHover, true);
    return () => window.removeEventListener("scroll", clearHover, true);
  }, []);

  const openPreview = (pageNumber: number) => {
    setHoverPreview(null);
    setLightboxPage(pageNumber);
  };

  const showHoverPreview = (source: string, rect: DOMRect) => {
    const width = 300;
    const gap = 16;
    let left = rect.right + gap;
    if (left + width > window.innerWidth - 16) {
      left = rect.left - width - gap;
    }
    left = Math.max(16, Math.min(left, window.innerWidth - width - 16));
    const top = Math.max(
      16,
      Math.min(rect.top, window.innerHeight - 440),
    );
    setHoverPreview({ source, left, top });
  };

  const selectedCount = selectedPages?.size ?? 0;

  return (
    <>
      <section className="preview-panel" aria-labelledby="preview-title">
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
                onHoverPreview={
                  selectable ? undefined : showHoverPreview
                }
                onHoverEnd={() => setHoverPreview(null)}
              />
            ))}
          </div>
        </div>

        <footer className="preview-foot">
          <span className="preview-foot-dot" />
          <span>
            {selectable
              ? "点击页面选择；右上角图标可查看大图"
              : footerText}
          </span>
        </footer>
      </section>

      {hoverPreview
        ? createPortal(
            <div
              className="page-hover-preview"
              style={{ left: hoverPreview.left, top: hoverPreview.top }}
              aria-hidden="true"
            >
              <img src={hoverPreview.source} alt="" />
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
            />,
            document.body,
          )
        : null}
    </>
  );
}
