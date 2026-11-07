import { Scissors } from "lucide-react";
import type { ToolManifest } from "../types";

export const splitPdfTool: ToolManifest = {
  id: "split-pdf",
  title: "拆分 PDF",
  description: "按页码范围、每 N 页或每页一页，把一份 PDF 拆成刚好合适的多份。",
  category: "organize",
  icon: Scissors,
  route: "/tools/split-pdf",
  keywords: ["pdf", "拆分", "分割", "split", "页码", "范围"],
  status: "available",
  order: 10,
  acceptsPdf: true,
};
