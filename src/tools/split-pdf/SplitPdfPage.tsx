import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  AlertTriangle,
  ArrowLeft,
  Info,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { useToolLaunch } from "../../app/LaunchContext";
import { useHashRoute } from "../../lib/router";
import {
  chooseOutputDirectory,
  downloadBytes,
  isTauriRuntime,
  openFolder,
  outputFileExists,
  pickPdf,
  readPdfFromPath,
  removeOutputFile,
  renameOutputFile,
  writeOutputFile,
  type ImportedPdf,
} from "../../lib/platform";
import {
  addCollisionSuffix,
  buildSplitPlan,
  formatPageSelection,
  parseSelectedPages,
  type SplitGroup,
  type SplitMode,
  type SplitPlan,
} from "./model";
import {
  disposePdfDocument,
  isInvalidPdfError,
  isPasswordError,
  loadPdfDocument,
} from "../../lib/pdfjs";
import { startSplitJob } from "./splitClient";
import { Dropzone } from "./components/Dropzone";
import { FileBar } from "../../components/pdf/FileBar";
import { PagePreview } from "../../components/pdf/PagePreview";
import { SettingsPanel } from "./components/SettingsPanel";
import { ResultView, type SplitResult } from "./components/ResultView";

type Phase = "empty" | "reading" | "ready" | "splitting" | "done";

interface SourceInfo {
  imported: ImportedPdf;
  pageCount: number;
}

interface ProgressState {
  completed: number;
  total: number;
  currentFile: string;
}

function describeLoadError(error: unknown): string {
  if (isPasswordError(error)) {
    return "这份 PDF 已加密，暂不支持拆分。请先移除密码后再试。";
  }
  if (isInvalidPdfError(error)) {
    return "无法打开这份 PDF，文件可能已损坏或格式不受支持。";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "无法打开这份 PDF，请稍后重试。";
}

function describeSplitError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const message = raw.trim();

  if (/encrypted|password/i.test(message)) {
    return "这份 PDF 有密码保护，暂不支持拆分。";
  }
  if (
    /permission|denied|forbidden|os error 5|拒绝访问|没有权限/i.test(message)
  ) {
    return "没有权限写入输出文件夹，请更换一个可写的目录。";
  }
  if (/no such file|not found|找不到/i.test(message)) {
    return "输出文件夹不存在，请重新选择保存位置。";
  }
  if (message) {
    return `拆分失败：${message}`;
  }
  return "拆分失败，请检查输出文件夹后重试。";
}

function readOpenAfterPreference(): boolean {
  try {
    return window.localStorage.getItem("pdf-workbench:open-after") === "true";
  } catch {
    return false;
  }
}

async function resolveOutputNames(
  directory: string,
  groups: SplitGroup[],
): Promise<string[]> {
  const used = new Set<string>();
  const names: string[] = [];

  for (const group of groups) {
    let attempt = 1;
    let candidate = group.fileName;

    while (attempt < 1000) {
      const key = candidate.toLowerCase();
      const fullPath = `${directory.replace(/[\\/]+$/, "")}${
        directory.includes("\\") ? "\\" : "/"
      }${candidate}`;
      if (!used.has(key) && !(await outputFileExists(fullPath))) {
        break;
      }
      attempt += 1;
      candidate = addCollisionSuffix(group.fileName, attempt);
    }

    if (attempt >= 1000) {
      throw new Error("输出目录中同名文件过多，请更换保存位置。");
    }

    used.add(candidate.toLowerCase());
    names.push(candidate);
  }

  return names;
}

function joinOutputPath(directory: string, name: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${name}`;
}

export default function SplitPdfPage() {
  const { navigate } = useHashRoute();
  const { pendingImport, clearPendingImport } = useToolLaunch();
  const isDesktop = isTauriRuntime();

  const [phase, setPhase] = useState<Phase>("empty");
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [mode, setMode] = useState<SplitMode>("selected");
  const [rangeInput, setRangeInput] = useState("");
  const [pagesPerFile, setPagesPerFile] = useState("10");
  const [selectionInput, setSelectionInput] = useState("");
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [outputDir, setOutputDir] = useState("");
  const [openAfter, setOpenAfter] = useState(readOpenAfterPreference);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProgressState>({
    completed: 0,
    total: 0,
    currentFile: "",
  });
  const [cancelling, setCancelling] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [result, setResult] = useState<SplitResult | null>(null);

  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const loadingRef = useRef(false);
  const jobActiveRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const lastPendingIdRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const planResult = useMemo(() => {
    if (!source) {
      return { plan: null, error: null };
    }
    return buildSplitPlan({
      mode,
      pageCount: source.pageCount,
      rangeInput,
      pagesPerFile,
      sourceName: source.imported.name,
      selectedPages,
    });
  }, [mode, pagesPerFile, rangeInput, selectedPages, source]);

  const plan: SplitPlan | null = planResult.plan;
  const canStart =
    phase === "ready" &&
    Boolean(source) &&
    Boolean(plan) &&
    (isDesktop ? Boolean(outputDir) : true);

  const commitPdf = useCallback(async (imported: ImportedPdf) => {
    const pdf = await loadPdfDocument(imported.bytes);
    if (pdf.numPages < 1) {
      await pdf.loadingTask.destroy();
      throw new Error("PDF 中没有可拆分的页面。");
    }

    const previous = pdfRef.current;
    pdfRef.current = pdf;

    if (mountedRef.current) {
      setSource({ imported, pageCount: pdf.numPages });
      setMode("selected");
      setRangeInput("");
      setSelectionInput("");
      setSelectedPages([]);
      setSelectionError(null);
      setPagesPerFile(
        String(Math.min(10, Math.max(1, Math.ceil(pdf.numPages / 2)))),
      );
      setOutputDir(imported.parent);
      setResult(null);
      setProgress({ completed: 0, total: 0, currentFile: "" });
      setPhase("ready");
    }

    if (previous) {
      disposePdfDocument(previous);
    }
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      if (loadingRef.current || jobActiveRef.current) {
        return;
      }

      loadingRef.current = true;
      const hadSource = Boolean(pdfRef.current);
      setPhase("reading");
      setLoadError(null);
      setJobError(null);
      setNotice(null);

      try {
        const imported = await readPdfFromPath(path);
        await commitPdf(imported);
      } catch (error) {
        setLoadError(describeLoadError(error));
        setPhase(hadSource ? "ready" : "empty");
      } finally {
        loadingRef.current = false;
      }
    },
    [commitPdf],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      disposePdfDocument(pdfRef.current);
      pdfRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!pendingImport || lastPendingIdRef.current === pendingImport.id) {
      return;
    }
    lastPendingIdRef.current = pendingImport.id;
    clearPendingImport();

    if (jobActiveRef.current || loadingRef.current) {
      setLoadError("当前有任务正在进行，请完成后再打开新的 PDF。");
      return;
    }

    void openPath(pendingImport.path);
  }, [clearPendingImport, openPath, pendingImport]);

  useEffect(() => {
    if (phase !== "splitting") {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [phase]);

  const handlePick = async () => {
    if (loadingRef.current || jobActiveRef.current) {
      return;
    }

    setLoadError(null);
    setJobError(null);
    setNotice(null);

    let imported: ImportedPdf | null = null;
    try {
      imported = await pickPdf("选择要拆分的 PDF");
    } catch (error) {
      setLoadError(describeLoadError(error));
      return;
    }

    if (!imported) {
      return;
    }

    const hadSource = Boolean(pdfRef.current);
    loadingRef.current = true;
    setPhase("reading");

    try {
      await commitPdf(imported);
    } catch (error) {
      setLoadError(describeLoadError(error));
      setPhase(hadSource ? "ready" : "empty");
    } finally {
      loadingRef.current = false;
    }
  };

  const handleChangeOutputDir = async () => {
    try {
      const selected = await chooseOutputDirectory(outputDir);
      if (selected) {
        setOutputDir(selected);
        setJobError(null);
      }
    } catch (error) {
      setJobError(describeLoadError(error));
    }
  };

  const handleOpenAfterChange = (value: boolean) => {
    setOpenAfter(value);
    try {
      window.localStorage.setItem(
        "pdf-workbench:open-after",
        value ? "true" : "false",
      );
    } catch {
      // The preference is not critical.
    }
  };

  const handleSelectionInputChange = (value: string) => {
    if (!source) {
      return;
    }

    setSelectionInput(value);
    if (!value.trim()) {
      setSelectedPages([]);
      setSelectionError(null);
      return;
    }

    const parsed = parseSelectedPages(value, source.pageCount);
    setSelectedPages(parsed.pages);
    setSelectionError(parsed.error);
  };

  const handleTogglePage = (pageNumber: number) => {
    if (!source) {
      return;
    }

    const next = selectedPages.includes(pageNumber)
      ? selectedPages.filter((page) => page !== pageNumber)
      : [...selectedPages, pageNumber].sort((a, b) => a - b);

    setSelectedPages(next);
    setSelectionInput(formatPageSelection(next));
    setSelectionError(null);
  };

  const handleSelectAll = () => {
    if (!source) {
      return;
    }
    const allPages = Array.from(
      { length: source.pageCount },
      (_, index) => index + 1,
    );
    setSelectedPages(allPages);
    setSelectionInput(formatPageSelection(allPages));
    setSelectionError(null);
  };

  const handleClearSelection = () => {
    setSelectedPages([]);
    setSelectionInput("");
    setSelectionError(null);
  };

  const handleCancel = () => {
    if (!cancelRef.current || cancelling) {
      return;
    }
    setCancelling(true);
    cancelRef.current();
  };

  const handleStart = async () => {
    if (!source || !plan || phase !== "ready" || jobActiveRef.current) {
      return;
    }

    const groups = plan.groups;
    const total = groups.length;
    const token = Date.now().toString(36);
    let tempFiles: Array<{ temporary: string; final: string }> = [];
    const committed: string[] = [];
    let names: string[] = [];

    setJobError(null);
    setNotice(null);
    setPhase("splitting");
    setCancelling(false);
    setCanCancel(false);
    setProgress({
      completed: 0,
      total,
      currentFile: isDesktop ? "正在准备输出位置…" : "正在准备下载…",
    });
    jobActiveRef.current = true;

    try {
      if (isDesktop) {
        if (!outputDir) {
          throw new Error("请先选择输出文件夹。");
        }
        names = await resolveOutputNames(outputDir, groups);
        tempFiles = groups.map((_, index) => ({
          temporary: joinOutputPath(
            outputDir,
            `.pdf-tool-${token}-${String(index + 1).padStart(4, "0")}.part`,
          ),
          final: joinOutputPath(outputDir, names[index]),
        }));
      } else {
        names = groups.map((group) => group.fileName);
      }

      const job = startSplitJob({
        data: source.imported.bytes,
        groups,
        onPart: async (index, bytes) => {
          const fileName = names[index] ?? groups[index].fileName;
          setProgress({
            completed: index,
            total,
            currentFile: fileName,
          });

          if (isDesktop) {
            await writeOutputFile(tempFiles[index].temporary, bytes);
          } else {
            downloadBytes(bytes, fileName);
          }

          if (mountedRef.current) {
            setProgress({
              completed: index + 1,
              total,
              currentFile: fileName,
            });
          }
        },
      });

      cancelRef.current = job.cancel;
      setCanCancel(true);

      const outcome = await job.done;

      if (outcome.cancelled) {
        await Promise.all(
          tempFiles.map((file) => removeOutputFile(file.temporary)),
        );
        if (!mountedRef.current) {
          return;
        }
        setPhase("ready");
        setNotice("已取消拆分，没有保留未完成的输出文件。");
        return;
      }

      if (isDesktop) {
        for (const file of tempFiles) {
          await renameOutputFile(file.temporary, file.final);
          committed.push(file.final);
        }
      }

      if (!mountedRef.current) {
        return;
      }

      const files = groups.map((group, index) => ({
        fileName: names[index] ?? group.fileName,
        pageLabel: group.pageLabel,
        pageCount: group.pageCount,
        path: isDesktop ? tempFiles[index].final : "",
      }));

      setResult({
        files,
        directory: outputDir,
        isDesktop,
        pageCount: source.pageCount,
      });
      setProgress({ completed: total, total, currentFile: "" });
      setPhase("done");

      if (isDesktop && openAfter) {
        void openFolder(outputDir).catch(() => undefined);
      }
    } catch (error) {
      await Promise.all(
        tempFiles.map((file) => removeOutputFile(file.temporary)),
      );
      await Promise.all(committed.map((path) => removeOutputFile(path)));

      if (!mountedRef.current) {
        return;
      }
      setPhase("ready");
      setJobError(describeSplitError(error));
    } finally {
      jobActiveRef.current = false;
      cancelRef.current = null;
      if (mountedRef.current) {
        setCanCancel(false);
        setCancelling(false);
      }
    }
  };

  const handleAgain = () => {
    setResult(null);
    setPhase("ready");
    setJobError(null);
    setNotice(null);
    setProgress({ completed: 0, total: 0, currentFile: "" });
  };

  const handleBack = () => {
    if (jobActiveRef.current) {
      return;
    }
    navigate("/");
  };

  if (phase === "done" && result) {
    return (
      <ResultView
        result={result}
        onAgain={handleAgain}
        onHome={() => navigate("/")}
      />
    );
  }

  const progressPercent =
    progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  return (
    <div className={`tool-page split-page ${source ? "has-file" : ""} page-enter`}>
      <div className="page-topbar">
        <button
          type="button"
          className="back-button"
          onClick={handleBack}
          disabled={phase === "splitting"}
        >
          <ArrowLeft size={15} />
          全部工具
        </button>
        <span className="breadcrumb-slash">/</span>
        <span className="breadcrumb-current">拆分 PDF</span>
        <span className="topbar-spacer" />
        <span className="local-chip">
          <ShieldCheck size={14} />
          本地处理
        </span>
      </div>

      <header className="tool-heading">
        <div>
          <span className="eyebrow">整理 PDF</span>
          <h1>拆分 PDF</h1>
          <p>按范围、页数或单页拆成多个文件，原始页面内容保持不变。</p>
        </div>
        {source ? (
          <span className="loaded-chip">
            <span className="loaded-dot" />
            已载入 · {source.pageCount} 页
          </span>
        ) : null}
      </header>

      {loadError ? (
        <div className="inline-alert page-alert" role="alert">
          <AlertTriangle size={16} />
          <span>{loadError}</span>
          <button
            type="button"
            className="alert-close"
            aria-label="关闭错误提示"
            onClick={() => setLoadError(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {notice ? (
        <div className="inline-notice page-alert" role="status">
          <Info size={15} />
          <span>{notice}</span>
          <button
            type="button"
            className="alert-close"
            aria-label="关闭提示"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {!source ? (
        <Dropzone busy={phase === "reading"} onPick={() => void handlePick()} />
      ) : (
        <>
          <FileBar
            name={source.imported.name}
            path={source.imported.path}
            size={source.imported.size}
            pageCount={source.pageCount}
            disabled={phase !== "ready"}
            onReplace={() => void handlePick()}
          />

          {phase === "reading" ? (
            <div className="reading-strip" role="status">
              <LoaderCircle size={15} className="spin" />
              正在打开新的 PDF，请稍候…
            </div>
          ) : null}

          <div className={`split-workspace ${phase === "reading" ? "is-busy" : ""}`}>
            <PagePreview
              pdf={pdfRef.current!}
              pageCount={source.pageCount}
              groups={plan?.groups ?? null}
              selectable={mode === "selected"}
              selectedPages={new Set(selectedPages)}
              onTogglePage={handleTogglePage}
            />
            <SettingsPanel
              mode={mode}
              onModeChange={(nextMode) => {
                setMode(nextMode);
                setJobError(null);
              }}
              rangeInput={rangeInput}
              onRangeInputChange={(value) => {
                setRangeInput(value);
                setJobError(null);
              }}
              pagesPerFile={pagesPerFile}
              onPagesPerFileChange={(value) => {
                setPagesPerFile(value);
                setJobError(null);
              }}
              selectionInput={selectionInput}
              onSelectionInputChange={handleSelectionInputChange}
              selectionError={selectionError}
              selectedCount={selectedPages.length}
              onSelectAll={handleSelectAll}
              onClearSelection={handleClearSelection}
              pageCount={source.pageCount}
              plan={plan}
              planError={planResult.error}
              outputDir={outputDir}
              isDesktop={isDesktop}
              onChangeOutputDir={() => void handleChangeOutputDir()}
              openAfter={openAfter}
              onOpenAfterChange={handleOpenAfterChange}
              error={jobError}
              canStart={canStart}
              onStart={() => void handleStart()}
            />
          </div>
        </>
      )}

      {phase === "splitting" ? (
        <div className="progress-backdrop">
          <div
            className="progress-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="progress-title"
          >
            <div className="progress-orb">
              <LoaderCircle size={26} className="spin" />
            </div>
            <span className="eyebrow centered">
              {cancelling ? "正在停止" : "本地处理中"}
            </span>
            <h2 id="progress-title">
              {cancelling ? "正在取消…" : "正在拆分"}
            </h2>
            <p className="progress-file" title={progress.currentFile}>
              {progress.currentFile || "准备输出文件…"}
            </p>

            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="progress-meta">
              <span>
                {progress.completed} / {progress.total} 个文件
              </span>
              <strong>{progressPercent}%</strong>
            </div>

            <button
              type="button"
              className="btn btn-secondary progress-cancel"
              onClick={handleCancel}
              disabled={!canCancel || cancelling}
            >
              {cancelling
                ? "等待当前文件完成…"
                : canCancel
                  ? "取消拆分"
                  : "准备中…"}
            </button>
            <p className="progress-note">
              取消后会清理未完成的临时文件，不会动原 PDF。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
