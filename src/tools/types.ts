import type { LucideIcon } from "lucide-react";

export type ToolCategory =
  | "organize"
  | "convert"
  | "secure"
  | "optimize"
  | "assets";

export type ToolStatus = "available" | "planned";

export interface ToolManifest {
  id: string;
  title: string;
  description: string;
  category: ToolCategory;
  icon: LucideIcon;
  route: string;
  keywords: string[];
  status: ToolStatus;
  order: number;
  acceptsPdf?: boolean;
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  organize: "整理",
  convert: "转换",
  secure: "安全",
  optimize: "优化",
  assets: "素材",
};
