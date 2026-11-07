import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import {
  FileOutput,
  Images,
  Layers3,
  Minimize2,
  ScanText,
} from "lucide-react";
import type { ToolManifest } from "./types";
import { splitPdfTool } from "./split-pdf/manifest";
import { spriteSlicerTool } from "./sprite-slicer/manifest";

const plannedTools: ToolManifest[] = [
  {
    id: "merge-pdf",
    title: "合并 PDF",
    description: "把多个 PDF 按顺序合成一份。",
    category: "organize",
    icon: Layers3,
    route: "/tools/merge-pdf",
    keywords: ["pdf", "合并", "merge"],
    status: "planned",
    order: 30,
  },
  {
    id: "extract-pages",
    title: "提取页面",
    description: "从 PDF 中挑出需要的页面。",
    category: "organize",
    icon: FileOutput,
    route: "/tools/extract-pages",
    keywords: ["pdf", "提取", "页面"],
    status: "planned",
    order: 40,
  },
  {
    id: "compress-pdf",
    title: "压缩 PDF",
    description: "在清晰度与文件体积之间找平衡。",
    category: "optimize",
    icon: Minimize2,
    route: "/tools/compress-pdf",
    keywords: ["pdf", "压缩", "体积"],
    status: "planned",
    order: 50,
  },
  {
    id: "pdf-to-images",
    title: "PDF 转图片",
    description: "将页面导出为 PNG 或 JPG。",
    category: "convert",
    icon: Images,
    route: "/tools/pdf-to-images",
    keywords: ["pdf", "图片", "png", "jpg"],
    status: "planned",
    order: 60,
  },
  {
    id: "ocr-pdf",
    title: "识别文字",
    description: "从扫描版 PDF 中提取可复制文字。",
    category: "convert",
    icon: ScanText,
    route: "/tools/ocr-pdf",
    keywords: ["pdf", "ocr", "文字", "扫描"],
    status: "planned",
    order: 70,
  },
];

export const allTools: ToolManifest[] = [
  splitPdfTool,
  spriteSlicerTool,
  ...plannedTools,
].sort((a, b) => a.order - b.order);

export const availableTools = allTools.filter(
  (tool) => tool.status === "available",
);

export const roadmapTools = allTools
  .filter((tool) => tool.status === "planned")
  .slice(0, 3);

export const toolPages: Record<
  string,
  LazyExoticComponent<ComponentType>
> = {
  [splitPdfTool.route]: lazy(() => import("./split-pdf/SplitPdfPage")),
  [spriteSlicerTool.route]: lazy(() => import("./sprite-slicer/SpritePage")),
};

export function getToolByRoute(route: string): ToolManifest | undefined {
  return availableTools.find((tool) => tool.route === route);
}
