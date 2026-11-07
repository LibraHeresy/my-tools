import { sanitizeBaseName } from "../../lib/fileNames";
import { GROUP_COLORS } from "../../lib/groupColors";

export { addCollisionSuffix, sanitizeBaseName } from "../../lib/fileNames";

export type SplitMode =
  | "ranges"
  | "every-n"
  | "each"
  | "odd-even"
  | "half"
  | "selected";

export interface PageRange {
  start: number;
  end: number;
}

export interface SplitGroup {
  index: number;
  start: number;
  end: number;
  pages: number[];
  pageLabel: string;
  fileName: string;
  colorIndex: number;
  pageCount: number;
}

export interface SplitPlan {
  mode: SplitMode;
  pageCount: number;
  groups: SplitGroup[];
}

export interface SplitPlanResult {
  plan: SplitPlan | null;
  error: string | null;
}

export interface BuildPlanInput {
  mode: SplitMode;
  pageCount: number;
  rangeInput: string;
  pagesPerFile: string;
  sourceName: string;
  selectedPages?: number[];
}

export interface ParsedRanges {
  ranges: PageRange[];
  error: string | null;
}

export interface ParsedSelection {
  pages: number[];
  error: string | null;
}

const GROUP_COLOR_COUNT = GROUP_COLORS.length;
const MAX_RANGES = 500;

function normalizeRangeInput(input: string): string {
  return input
    .replace(/[０-９]/g, (character) =>
      String(character.charCodeAt(0) - 0xff10),
    )
    .replace(/[，、]/g, ",")
    .replace(/[–—−－]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePageRanges(
  input: string,
  pageCount: number,
  options: { allowOverlap?: boolean } = {},
): ParsedRanges {
  const normalized = normalizeRangeInput(input);
  if (!normalized) {
    return { ranges: [], error: "请输入页码范围，例如 1-3, 5, 8-10。" };
  }

  const segments = normalized
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return { ranges: [], error: "请输入页码范围，例如 1-3, 5, 8-10。" };
  }

  if (segments.length > MAX_RANGES) {
    return {
      ranges: [],
      error: `一次最多处理 ${MAX_RANGES} 个范围，请减少范围数量。`,
    };
  }

  const ranges: PageRange[] = [];

  for (const segment of segments) {
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(segment);
    if (!match) {
      return {
        ranges: [],
        error: `“${segment}”格式不正确，请使用 1-3 或 5 这样的写法。`,
      };
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;

    if (start < 1 || end < 1) {
      return { ranges: [], error: "页码必须从 1 开始。" };
    }

    if (start > pageCount || end > pageCount) {
      return {
        ranges: [],
        error: `页码超出范围，本文件共 ${pageCount} 页。`,
      };
    }

    if (start > end) {
      return {
        ranges: [],
        error: `范围 ${start}-${end} 的起始页不能大于结束页。`,
      };
    }

    ranges.push({ start, end });
  }

  if (!options.allowOverlap) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (current.start <= previous.end) {
        return {
          ranges: [],
          error: `范围 ${previous.start}-${previous.end} 与 ${current.start}-${current.end} 有重叠，请调整。`,
        };
      }
    }
  }

  return { ranges, error: null };
}

export function parseSelectedPages(
  input: string,
  pageCount: number,
): ParsedSelection {
  const parsed = parsePageRanges(input, pageCount, { allowOverlap: true });
  if (parsed.error) {
    return { pages: [], error: parsed.error };
  }

  const pageSet = new Set<number>();
  for (const range of parsed.ranges) {
    for (let page = range.start; page <= range.end; page += 1) {
      pageSet.add(page);
    }
  }

  return {
    pages: [...pageSet].sort((a, b) => a - b),
    error: null,
  };
}

export function formatPageSelection(pages: number[]): string {
  const sorted = [...new Set(pages)]
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((a, b) => a - b);

  const ranges: PageRange[] = [];
  for (const page of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && page === last.end + 1) {
      last.end = page;
    } else {
      ranges.push({ start: page, end: page });
    }
  }

  return ranges
    .map((range) =>
      range.start === range.end
        ? String(range.start)
        : `${range.start}-${range.end}`,
    )
    .join(", ");
}

function toPages(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function createGroup(
  index: number,
  pages: number[],
  fileName: string,
  pageLabel: string,
): SplitGroup {
  const sorted = [...new Set(pages)]
    .filter((page) => Number.isInteger(page) && page > 0)
    .sort((a, b) => a - b);

  return {
    index,
    start: sorted[0],
    end: sorted[sorted.length - 1],
    pages: sorted,
    pageLabel,
    fileName,
    colorIndex: index % GROUP_COLOR_COUNT,
    pageCount: sorted.length,
  };
}

function makeRangeFileName(
  baseName: string,
  start: number,
  end: number,
): string {
  const label = start === end ? String(start) : `${start}-${end}`;
  return `${baseName}_第${label}页.pdf`;
}

function makeGroupsFromRanges(
  ranges: PageRange[],
  baseName: string,
): SplitGroup[] {
  return ranges.map((range, index) =>
    createGroup(
      index,
      toPages(range.start, range.end),
      makeRangeFileName(baseName, range.start, range.end),
      range.start === range.end
        ? String(range.start)
        : `${range.start}-${range.end}`,
    ),
  );
}

function makeOddEvenGroups(
  pageCount: number,
  baseName: string,
): SplitGroup[] {
  const oddPages: number[] = [];
  const evenPages: number[] = [];

  for (let page = 1; page <= pageCount; page += 1) {
    if (page % 2 === 1) {
      oddPages.push(page);
    } else {
      evenPages.push(page);
    }
  }

  const groups: SplitGroup[] = [];
  if (oddPages.length > 0) {
    groups.push(
      createGroup(0, oddPages, `${baseName}_奇数页.pdf`, "奇数页"),
    );
  }
  if (evenPages.length > 0) {
    groups.push(
      createGroup(1, evenPages, `${baseName}_偶数页.pdf`, "偶数页"),
    );
  }
  return groups;
}

function makeHalfGroups(pageCount: number, baseName: string): SplitGroup[] {
  const firstHalfEnd = Math.ceil(pageCount / 2);
  const groups: SplitGroup[] = [
    createGroup(
      0,
      toPages(1, firstHalfEnd),
      `${baseName}_前半.pdf`,
      "前半",
    ),
  ];

  if (firstHalfEnd < pageCount) {
    groups.push(
      createGroup(
        1,
        toPages(firstHalfEnd + 1, pageCount),
        `${baseName}_后半.pdf`,
        "后半",
      ),
    );
  }

  return groups;
}

export function buildSplitPlan(input: BuildPlanInput): SplitPlanResult {
  const {
    mode,
    pageCount,
    rangeInput,
    pagesPerFile,
    sourceName,
    selectedPages = [],
  } = input;

  if (!Number.isInteger(pageCount) || pageCount < 1) {
    return { plan: null, error: "PDF 中没有可拆分的页面。" };
  }

  const baseName = sanitizeBaseName(sourceName);
  let groups: SplitGroup[] = [];

  if (mode === "ranges") {
    const parsed = parsePageRanges(rangeInput, pageCount);
    if (parsed.error) {
      return { plan: null, error: parsed.error };
    }
    groups = makeGroupsFromRanges(parsed.ranges, baseName);
  } else if (mode === "every-n") {
    const trimmed = pagesPerFile.trim();
    if (!/^\d+$/.test(trimmed)) {
      return { plan: null, error: "请输入大于 0 的整数。" };
    }

    const pageStep = Number(trimmed);
    if (pageStep < 1) {
      return { plan: null, error: "每份至少需要 1 页。" };
    }
    if (pageStep > pageCount) {
      return {
        plan: null,
        error: `每份页数不能超过文件总页数（${pageCount} 页）。`,
      };
    }

    for (let start = 1; start <= pageCount; start += pageStep) {
      const end = Math.min(start + pageStep - 1, pageCount);
      const index = groups.length;
      groups.push(
        createGroup(
          index,
          toPages(start, end),
          makeRangeFileName(baseName, start, end),
          start === end ? String(start) : `${start}-${end}`,
        ),
      );
    }
  } else if (mode === "each") {
    const digits = Math.max(3, String(pageCount).length);
    for (let page = 1; page <= pageCount; page += 1) {
      const label = String(page).padStart(digits, "0");
      groups.push(
        createGroup(
          page - 1,
          [page],
          `${baseName}_第${label}页.pdf`,
          String(page),
        ),
      );
    }
  } else if (mode === "odd-even") {
    groups = makeOddEvenGroups(pageCount, baseName);
  } else if (mode === "half") {
    groups = makeHalfGroups(pageCount, baseName);
  } else {
    const pages = [...new Set(selectedPages)]
      .filter(
        (page) =>
          Number.isInteger(page) && page >= 1 && page <= pageCount,
      )
      .sort((a, b) => a - b);

    if (pages.length === 0) {
      return { plan: null, error: "请先在预览区选择至少一页。" };
    }

    groups = [
      createGroup(
        0,
        pages,
        `${baseName}_指定页.pdf`,
        "指定页",
      ),
    ];
  }

  if (groups.length === 0) {
    return { plan: null, error: "没有可输出的页面。" };
  }

  return {
    plan: { mode, pageCount, groups },
    error: null,
  };
}
