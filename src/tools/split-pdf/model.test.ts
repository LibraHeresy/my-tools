import { describe, expect, it } from "vitest";
import {
  addCollisionSuffix,
  buildSplitPlan,
  formatPageSelection,
  parsePageRanges,
  parseSelectedPages,
  sanitizeBaseName,
} from "./model";

describe("parsePageRanges", () => {
  it("parses comma separated ranges and single pages", () => {
    expect(parsePageRanges("1-3, 5, 8–10", 12)).toEqual({
      ranges: [
        { start: 1, end: 3 },
        { start: 5, end: 5 },
        { start: 8, end: 10 },
      ],
      error: null,
    });
  });

  it("normalizes Chinese punctuation and full width numbers", () => {
    expect(parsePageRanges("１－２，４", 8)).toEqual({
      ranges: [
        { start: 1, end: 2 },
        { start: 4, end: 4 },
      ],
      error: null,
    });
  });

  it("rejects reversed ranges", () => {
    const result = parsePageRanges("5-3", 10);
    expect(result.error).toContain("起始页不能大于结束页");
  });

  it("rejects overlapping ranges", () => {
    const result = parsePageRanges("1-3, 3-5", 10);
    expect(result.error).toContain("有重叠");
  });

  it("rejects pages past the end of the document", () => {
    const result = parsePageRanges("1-11", 10);
    expect(result.error).toContain("本文件共 10 页");
  });
});

describe("parseSelectedPages", () => {
  it("merges overlapping ranges, removes duplicates and sorts pages", () => {
    expect(parseSelectedPages("5, 1-3, 3-4", 10)).toEqual({
      pages: [1, 2, 3, 4, 5],
      error: null,
    });
  });

  it("formats selected pages back into compact ranges", () => {
    expect(formatPageSelection([3, 1, 2, 7, 9, 10])).toBe("1-3, 7, 9-10");
  });

  it("rejects invalid selected page input", () => {
    const result = parseSelectedPages("0-2", 10);
    expect(result.pages).toEqual([]);
    expect(result.error).toContain("页码必须从 1 开始");
  });
});

describe("buildSplitPlan", () => {
  const base = {
    pageCount: 7,
    sourceName: "示例 文档.pdf",
    rangeInput: "",
    pagesPerFile: "3",
  };

  it("creates one output per range", () => {
    const result = buildSplitPlan({
      ...base,
      mode: "ranges",
      rangeInput: "1-3, 5",
    });

    expect(result.error).toBeNull();
    expect(result.plan?.groups.map((group) => group.fileName)).toEqual([
      "示例 文档_第1-3页.pdf",
      "示例 文档_第5页.pdf",
    ]);
    expect(result.plan?.groups[1].pages).toEqual([5]);
  });

  it("splits every N pages, including a shorter final group", () => {
    const result = buildSplitPlan({
      ...base,
      mode: "every-n",
      pagesPerFile: "3",
    });

    expect(result.plan?.groups.map((group) => group.pageLabel)).toEqual([
      "1-3",
      "4-6",
      "7",
    ]);
  });

  it("pads page numbers when splitting every page", () => {
    const result = buildSplitPlan({
      ...base,
      mode: "each",
    });

    expect(result.plan?.groups).toHaveLength(7);
    expect(result.plan?.groups[0].fileName).toBe("示例 文档_第001页.pdf");
    expect(result.plan?.groups[6].fileName).toBe("示例 文档_第007页.pdf");
  });

  it("rejects a page step larger than the document", () => {
    const result = buildSplitPlan({
      ...base,
      mode: "every-n",
      pagesPerFile: "8",
    });
    expect(result.error).toContain("不能超过文件总页数");
  });

  it("creates odd and even outputs", () => {
    const result = buildSplitPlan({
      ...base,
      pageCount: 5,
      mode: "odd-even",
    });

    expect(result.plan?.groups.map((group) => group.fileName)).toEqual([
      "示例 文档_奇数页.pdf",
      "示例 文档_偶数页.pdf",
    ]);
    expect(result.plan?.groups[0].pages).toEqual([1, 3, 5]);
    expect(result.plan?.groups[1].pages).toEqual([2, 4]);
    expect(result.plan?.groups[0].pageCount).toBe(3);
  });

  it("splits a document in half with an upper-rounded first half", () => {
    const result = buildSplitPlan({
      ...base,
      pageCount: 7,
      mode: "half",
    });

    expect(result.plan?.groups.map((group) => group.fileName)).toEqual([
      "示例 文档_前半.pdf",
      "示例 文档_后半.pdf",
    ]);
    expect(result.plan?.groups[0].pages).toEqual([1, 2, 3, 4]);
    expect(result.plan?.groups[1].pages).toEqual([5, 6, 7]);
  });

  it("does not create an empty half for a single-page document", () => {
    const result = buildSplitPlan({
      ...base,
      pageCount: 1,
      mode: "half",
    });

    expect(result.plan?.groups).toHaveLength(1);
    expect(result.plan?.groups[0].pages).toEqual([1]);
  });

  it("creates one sorted output for selected pages", () => {
    const result = buildSplitPlan({
      ...base,
      pageCount: 8,
      mode: "selected",
      selectedPages: [7, 2, 4, 2],
    });

    expect(result.error).toBeNull();
    expect(result.plan?.groups).toHaveLength(1);
    expect(result.plan?.groups[0].fileName).toBe("示例 文档_指定页.pdf");
    expect(result.plan?.groups[0].pages).toEqual([2, 4, 7]);
    expect(result.plan?.groups[0].pageCount).toBe(3);
  });

  it("requires at least one selected page", () => {
    const result = buildSplitPlan({
      ...base,
      mode: "selected",
      selectedPages: [],
    });
    expect(result.error).toContain("请先在预览区选择至少一页");
  });
});

describe("file naming", () => {
  it("sanitizes Windows-invalid characters", () => {
    expect(sanitizeBaseName('报告: 2026/03*?"<>|.pdf')).toBe(
      "报告_ 2026_03______",
    );
  });

  it("protects reserved device names", () => {
    expect(sanitizeBaseName("CON.pdf")).toBe("_CON");
  });

  it("adds a collision suffix before the extension", () => {
    expect(addCollisionSuffix("文档_第1页.pdf", 2)).toBe(
      "文档_第1页 (2).pdf",
    );
  });
});
