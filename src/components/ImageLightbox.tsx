import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  X,
} from "lucide-react";

export interface ImageLightboxItem {
  src: string;
  name: string;
  meta?: string;
  checker?: boolean;
}

interface ImageLightboxProps {
  items: ImageLightboxItem[];
  initialIndex: number;
  onClose: () => void;
  onIndexChange?: (index: number) => void;
}

export function ImageLightbox({
  items,
  initialIndex,
  onClose,
  onIndexChange,
}: ImageLightboxProps) {
  const [index, setIndex] = useState(
    Math.max(0, Math.min(initialIndex, items.length - 1)),
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const current = items[index];

  useEffect(() => {
    onIndexChangeRef.current?.(index);
  }, [index]);

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
        setIndex((value) => Math.max(0, value - 1));
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((value) => Math.min(items.length - 1, value + 1));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [items.length, onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!current) {
    return null;
  }

  return (
    <div
      className="image-lightbox-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="image-lightbox"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-lightbox-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="image-lightbox-head">
          <div className="image-lightbox-copy">
            <span className="panel-kicker">大图预览</span>
            <h2 id="image-lightbox-title" title={current.name}>
              {current.name}
            </h2>
            {current.meta ? (
              <span className="image-lightbox-meta">{current.meta}</span>
            ) : null}
          </div>
          <div className="image-lightbox-head-actions">
            <span className="image-lightbox-count">
              {index + 1} / {items.length}
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

        <div className="image-lightbox-stage">
          <button
            type="button"
            className="image-lightbox-nav"
            aria-label="上一张"
            onClick={() => setIndex((value) => Math.max(0, value - 1))}
            disabled={index === 0}
          >
            <ChevronLeft size={22} />
          </button>

          <div
            className={`image-lightbox-frame ${
              current.checker ? "is-checker" : ""
            }`}
          >
            <img src={current.src} alt={current.name} />
          </div>

          <button
            type="button"
            className="image-lightbox-nav"
            aria-label="下一张"
            onClick={() =>
              setIndex((value) => Math.min(items.length - 1, value + 1))
            }
            disabled={index === items.length - 1}
          >
            <ChevronRight size={22} />
          </button>
        </div>

        <footer className="image-lightbox-foot">
          <span className="image-lightbox-foot-hint">
            <ImageIcon size={13} />
            {items.length > 1 ? "← → 切换图片" : "原图完整显示"}
          </span>
          <span>Esc 关闭</span>
        </footer>
      </section>
    </div>
  );
}
