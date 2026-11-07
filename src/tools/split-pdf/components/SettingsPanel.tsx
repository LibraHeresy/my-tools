import {
  AlertTriangle,
  Columns2,
  FileStack,
  Folder,
  FolderOpen,
  Layers3,
  ListOrdered,
  Minus,
  MousePointer2,
  Plus,
  Rows2,
  Scissors,
} from "lucide-react";
import type { SplitGroup, SplitMode, SplitPlan } from "../model";
import { GROUP_COLORS } from "../../../lib/groupColors";
import { truncateMiddle } from "../../../lib/format";

interface SettingsPanelProps {
  mode: SplitMode;
  onModeChange: (mode: SplitMode) => void;
  rangeInput: string;
  onRangeInputChange: (value: string) => void;
  pagesPerFile: string;
  onPagesPerFileChange: (value: string) => void;
  selectionInput: string;
  onSelectionInputChange: (value: string) => void;
  selectionError: string | null;
  selectedCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  pageCount: number;
  plan: SplitPlan | null;
  planError: string | null;
  outputDir: string;
  isDesktop: boolean;
  onChangeOutputDir: () => void;
  openAfter: boolean;
  onOpenAfterChange: (value: boolean) => void;
  error: string | null;
  canStart: boolean;
  onStart: () => void;
}

const MODES: Array<{
  id: SplitMode;
  title: string;
  hint: string;
  icon: typeof ListOrdered;
}> = [
  {
    id: "ranges",
    title: "按范围",
    hint: "每个范围一份",
    icon: ListOrdered,
  },
  {
    id: "every-n",
    title: "每 N 页",
    hint: "固定页数切分",
    icon: Layers3,
  },
  {
    id: "each",
    title: "每页一份",
    hint: "一页一个文件",
    icon: FileStack,
  },
  {
    id: "odd-even",
    title: "单双页",
    hint: "奇偶各一份",
    icon: Columns2,
  },
  {
    id: "half",
    title: "对半",
    hint: "前后各一份",
    icon: Rows2,
  },
  {
    id: "selected",
    title: "指定页",
    hint: "手输或点选",
    icon: MousePointer2,
  },
];

function OutputList({ groups }: { groups: SplitGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="plan-placeholder">
        <FileStack size={18} />
        <span>确定拆分方式后，在这里预览输出文件。</span>
      </div>
    );
  }

  const visible = groups.slice(0, 3);
  const hiddenCount = groups.length - visible.length;

  return (
    <div className="plan-list">
      <ul>
        {visible.map((group) => (
          <li key={group.index}>
            <span
              className="plan-color"
              style={{
                backgroundColor:
                  GROUP_COLORS[group.colorIndex % GROUP_COLORS.length],
              }}
            />
            <span className="plan-name" title={group.fileName}>
              {group.fileName}
            </span>
            <span className="plan-pages">{group.pageCount} 页</span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <p className="plan-more">另有 {hiddenCount} 个文件</p>
      ) : null}
    </div>
  );
}

function adjustNumber(value: string, delta: number, max: number): string {
  const parsed = Number.parseInt(value, 10);
  const current = Number.isFinite(parsed) ? parsed : 1;
  return String(Math.min(max, Math.max(1, current + delta)));
}

export function SettingsPanel({
  mode,
  onModeChange,
  rangeInput,
  onRangeInputChange,
  pagesPerFile,
  onPagesPerFileChange,
  selectionInput,
  onSelectionInputChange,
  selectionError,
  selectedCount,
  onSelectAll,
  onClearSelection,
  pageCount,
  plan,
  planError,
  outputDir,
  isDesktop,
  onChangeOutputDir,
  openAfter,
  onOpenAfterChange,
  error,
  canStart,
  onStart,
}: SettingsPanelProps) {
  const groups = plan?.groups ?? [];
  const rangeError =
    mode === "ranges" && rangeInput.trim() ? planError : null;
  const everyNError =
    mode === "every-n" && pagesPerFile.trim() ? planError : null;
  const selectionInputError =
    mode === "selected" && selectionInput.trim() ? selectionError : null;

  const stepDown = () =>
    onPagesPerFileChange(adjustNumber(pagesPerFile, -1, pageCount));
  const stepUp = () =>
    onPagesPerFileChange(adjustNumber(pagesPerFile, 1, pageCount));

  return (
    <aside className="settings-panel" aria-label="拆分设置">
      <div className="settings-head">
        <div>
          <span className="panel-kicker">设置</span>
          <h2>怎么拆</h2>
        </div>
        <span className="settings-page-count">{pageCount} 页</span>
      </div>

      <div className="settings-body">
        <div className="settings-section">
          <div className="field-label">拆分方式</div>
          <div className="mode-switch" role="radiogroup" aria-label="拆分方式">
            {MODES.map((item) => {
              const Icon = item.icon;
              const selected = item.id === mode;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`mode-button ${selected ? "is-selected" : ""}`}
                  onClick={() => onModeChange(item.id)}
                >
                  <Icon size={17} />
                  <span>{item.title}</span>
                  <small>{item.hint}</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="settings-section mode-field">
          {mode === "ranges" ? (
            <>
              <label className="field-label" htmlFor="range-input">
                页码范围
              </label>
              <input
                id="range-input"
                className={`text-input mono ${rangeError ? "has-error" : ""}`}
                value={rangeInput}
                onChange={(event) => onRangeInputChange(event.target.value)}
                placeholder="1-3, 5, 8-10"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={Boolean(rangeError)}
                aria-describedby="range-help"
              />
              <p
                id="range-help"
                className={`field-hint ${rangeError ? "is-error" : ""}`}
              >
                {rangeError ? (
                  <>
                    <AlertTriangle size={13} />
                    {rangeError}
                  </>
                ) : (
                  <>每个范围生成一份文件，用逗号分隔。</>
                )}
              </p>
            </>
          ) : null}

          {mode === "every-n" ? (
            <>
              <label className="field-label" htmlFor="page-step">
                每份页数
              </label>
              <div className={`stepper ${everyNError ? "has-error" : ""}`}>
                <button
                  type="button"
                  className="stepper-button"
                  aria-label="减少每份页数"
                  onClick={stepDown}
                  disabled={Number(pagesPerFile) <= 1}
                >
                  <Minus size={15} />
                </button>
                <input
                  id="page-step"
                  className="stepper-input"
                  value={pagesPerFile}
                  inputMode="numeric"
                  onChange={(event) =>
                    onPagesPerFileChange(event.target.value.replace(/\D/g, ""))
                  }
                  aria-invalid={Boolean(everyNError)}
                  aria-describedby="steps-help"
                />
                <button
                  type="button"
                  className="stepper-button"
                  aria-label="增加每份页数"
                  onClick={stepUp}
                  disabled={Number(pagesPerFile) >= pageCount}
                >
                  <Plus size={15} />
                </button>
              </div>
              <p
                id="steps-help"
                className={`field-hint ${everyNError ? "is-error" : ""}`}
              >
                {everyNError ? (
                  <>
                    <AlertTriangle size={13} />
                    {everyNError}
                  </>
                ) : plan ? (
                  <>将生成 {plan.groups.length} 份，最后一份可以少于 {pagesPerFile} 页。</>
                ) : (
                  <>从第 1 页开始，按固定页数切分。</>
                )}
              </p>
            </>
          ) : null}

          {mode === "each" ? (
            <div className="mode-note">
              <Scissors size={16} />
              <span>
                每一页都会成为一个独立的 PDF，共 {pageCount} 个文件。
              </span>
            </div>
          ) : null}

          {mode === "odd-even" ? (
            <div className="mode-note">
              <Columns2 size={16} />
              <span>
                交错拆分：奇数页、偶数页各生成一个 PDF；只有一页时只生成奇数页文件。
              </span>
            </div>
          ) : null}

          {mode === "half" ? (
            <div className="mode-note">
              <Rows2 size={16} />
              <span>
                对半拆分：从中间分成前后两份，前一半向上取整；11 页会拆成
                1-6 和 7-11。
              </span>
            </div>
          ) : null}

          {mode === "selected" ? (
            <>
              <div className="selection-input-head">
                <label className="field-label" htmlFor="selection-input">
                  指定页码
                </label>
                <div className="selection-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={onSelectAll}
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={onClearSelection}
                    disabled={selectedCount === 0}
                  >
                    清空
                  </button>
                </div>
              </div>
              <input
                id="selection-input"
                className={`text-input mono ${
                  selectionInputError ? "has-error" : ""
                }`}
                value={selectionInput}
                onChange={(event) =>
                  onSelectionInputChange(event.target.value)
                }
                placeholder="3, 7, 10-12"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={Boolean(selectionInputError)}
                aria-describedby="selection-help"
              />
              <p
                id="selection-help"
                className={`field-hint ${
                  selectionInputError ? "is-error" : ""
                }`}
              >
                {selectionInputError ? (
                  <>
                    <AlertTriangle size={13} />
                    {selectionInputError}
                  </>
                ) : selectedCount > 0 ? (
                  <>已选择 {selectedCount} 页，将合并为一个 PDF。</>
                ) : (
                  <>点击预览区页面选择，或手动输入页码。</>
                )}
              </p>
            </>
          ) : null}
        </div>

        <div className="settings-section">
          <div className="section-label-row">
            <div className="field-label">输出预览</div>
            {groups.length > 0 ? (
              <span className="count-chip">{groups.length} 个文件</span>
            ) : null}
          </div>
          <OutputList groups={groups} />
          {groups.length > 0 ? (
            <p className="plan-note">同名文件会自动编号，不会覆盖原文件。</p>
          ) : null}
        </div>
      </div>

      <div className="settings-actions">
        {error ? (
          <div className="inline-alert" role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="output-location">
          <span className="output-icon">
            <Folder size={15} />
          </span>
          <span
            className={`output-path ${outputDir ? "" : "is-empty"}`}
            title={outputDir}
          >
            {isDesktop
              ? outputDir
                ? truncateMiddle(outputDir, 30)
                : "请选择输出文件夹"
              : "浏览器下载目录"}
          </span>
          {isDesktop ? (
            <button
              type="button"
              className="text-button output-change"
              onClick={onChangeOutputDir}
            >
              更改
            </button>
          ) : null}
        </div>

        {isDesktop ? (
          <label className="check-row">
            <input
              type="checkbox"
              checked={openAfter}
              onChange={(event) => onOpenAfterChange(event.target.checked)}
            />
            <span className="check-box" aria-hidden="true">
              <FolderOpen size={12} />
            </span>
            <span>完成后打开输出文件夹</span>
          </label>
        ) : null}

        <button
          type="button"
          className="btn btn-primary btn-start"
          onClick={onStart}
          disabled={!canStart}
        >
          <Scissors size={18} />
          {groups.length > 0 ? `开始拆分 · ${groups.length} 个文件` : "开始拆分"}
        </button>
      </div>
    </aside>
  );
}
