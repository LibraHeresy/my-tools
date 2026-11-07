import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ArrowRight, FileUp, ShieldCheck } from "lucide-react";
import { AboutDialog } from "./app/AboutDialog";
import { UpdateDialog } from "./app/UpdateDialog";
import { useUpdater } from "./app/useUpdater";
import { AppShell } from "./app/AppShell";
import { ToolLaunchContext, type PendingImport } from "./app/LaunchContext";
import { Toast, type ToastData, type ToastTone } from "./components/Toast";
import { truncateMiddle } from "./lib/format";
import { isTauriRuntime } from "./lib/platform";
import { useHashRoute } from "./lib/router";
import { HomePage } from "./pages/HomePage";
import {
  availableTools,
  getToolByRoute,
  roadmapTools,
  toolPages,
} from "./tools/registry";

function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path);
}

export default function App() {
  const { route, navigate } = useHashRoute();
  const updater = useUpdater();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [droppedPath, setDroppedPath] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const pdfTools = availableTools.filter((item) => item.acceptsPdf);
  const tool = getToolByRoute(route);
  const ToolPage = tool ? toolPages[tool.route] : undefined;
  const isHome = route === "/";
  const isAssetTool =
    tool?.id === "sprite-slice" ||
    tool?.id === "sprite-pack" ||
    tool?.id === "image-to-png";

  useEffect(() => {
    if (route === "/tools/sprite-slicer") {
      navigate("/tools/sprite-slice");
    }
  }, [navigate, route]);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    const nextToast = { id: Date.now(), message, tone };
    setToast(nextToast);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => (current?.id === nextToast.id ? null : current));
      toastTimerRef.current = null;
    }, 4200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!droppedPath) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDroppedPath(null);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [droppedPath]);

  const clearPendingImport = useCallback(() => {
    setPendingImport(null);
  }, []);

  const handleHome = useCallback(() => {
    setPendingImport(null);
    setDroppedPath(null);
    navigate("/");
  }, [navigate]);

  const openTool = useCallback(
    (toolRoute: string) => {
      setPendingImport(null);
      setDroppedPath(null);
      navigate(toolRoute);
    },
    [navigate],
  );

  useEffect(() => {
    if (!isTauriRuntime() || isAssetTool) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/webview")
      .then(async ({ getCurrentWebview }) => {
        const stop = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;

          if (payload.type === "enter") {
            setDragging(true);
            return;
          }

          if (payload.type === "over") {
            return;
          }

          if (payload.type === "leave") {
            setDragging(false);
            return;
          }

          if (payload.type === "drop") {
            setDragging(false);
            const pdfPath = payload.paths.find(isPdfPath);
            if (!pdfPath) {
              showToast("这里只支持 PDF 文件。", "error");
              return;
            }

            const activeTool = getToolByRoute(route);
            if (activeTool?.acceptsPdf) {
              setPendingImport({ path: pdfPath, id: Date.now() });
            } else {
              setDroppedPath(pdfPath);
            }
          }
        });

        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch(() => {
        // Drag & drop is a convenience; the file picker remains available.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isAssetTool, route, showToast]);

  const openDroppedWithTool = (toolRoute: string) => {
    if (!droppedPath) {
      return;
    }
    setPendingImport({ path: droppedPath, id: Date.now() });
    setDroppedPath(null);
    if (route !== toolRoute) {
      navigate(toolRoute);
    }
  };

  return (
    <ToolLaunchContext.Provider
      value={{ pendingImport, clearPendingImport }}
    >
      <AppShell
        isHome={isHome}
        currentTool={tool}
        tools={availableTools}
        onToolSelect={openTool}
        onHome={handleHome}
        onAbout={() => setAboutOpen(true)}
      >
        {isHome ? (
          <HomePage
            tools={availableTools}
            roadmap={roadmapTools}
            onOpenTool={openTool}
          />
        ) : ToolPage ? (
          <Suspense
            fallback={
              <div className="page-loading">
                <span className="loading-ring" />
                正在打开工具…
              </div>
            }
          >
            <ToolPage />
          </Suspense>
        ) : (
          <div className="not-found page-enter">
            <span className="eyebrow">404</span>
            <h1>没有这个工具</h1>
            <p>它可能还没有加入工具台，或者链接已经失效。</p>
            <button type="button" className="btn btn-primary" onClick={handleHome}>
              返回工具列表
            </button>
          </div>
        )}
      </AppShell>

      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        onCheckUpdate={() => {
          setAboutOpen(false);
          void updater.checkForUpdates(true);
        }}
      />

      <UpdateDialog
        open={updater.open}
        phase={updater.phase}
        update={updater.update}
        progress={updater.progress}
        error={updater.error}
        onInstall={() => void updater.install()}
        onRetry={() => void updater.checkForUpdates(true)}
        onClose={updater.closeDialog}
      />

      {dragging ? (
        <div className="drag-overlay" aria-hidden="true">
          <div className="drag-card">
            <div className="drag-icon">
              <FileUp size={28} />
            </div>
            <span className="eyebrow">拖放 PDF</span>
            <h2>
              {tool?.acceptsPdf
                ? "松开以打开这份文件"
                : "松开后选择要使用的工具"}
            </h2>
            <p>
              {tool?.acceptsPdf
                ? "文件会载入当前工具，不会离开本机。"
                : "可以选择拆分 PDF，文件不会离开本机。"}
            </p>
            <span className="drag-local">
              <ShieldCheck size={13} />
              本地处理
            </span>
          </div>
        </div>
      ) : null}

      {droppedPath ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDroppedPath(null);
            }
          }}
        >
          <div
            className="tool-picker"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tool-picker-title"
          >
            <span className="eyebrow">打开 PDF</span>
            <h2 id="tool-picker-title">用哪个工具打开？</h2>
            <p className="tool-picker-path" title={droppedPath}>
              {truncateMiddle(droppedPath, 76)}
            </p>

            <div className="drop-tool-list">
              {pdfTools.map((item, index) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="drop-tool"
                    autoFocus={index === 0}
                    onClick={() => openDroppedWithTool(item.route)}
                  >
                    <span className="drop-tool-icon">
                      <Icon size={20} />
                    </span>
                    <span className="drop-tool-copy">
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="text-button tool-picker-cancel"
              onClick={() => setDroppedPath(null)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}

      {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
    </ToolLaunchContext.Provider>
  );
}
