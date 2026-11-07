import { Grid3X3, Package } from "lucide-react";
import type { ToolManifest } from "../types";

const keywords = [
  "sprite",
  "spritesheet",
  "精灵图",
  "图集",
  "切图",
  "打包",
  "texturepacker",
  "游戏素材",
];

export const spriteSliceTool: ToolManifest = {
  id: "sprite-slice",
  title: "精灵图切图",
  description: "自动识别 PNG 精灵图集，切分并导出逐张精灵和 TexturePacker JSON。",
  category: "assets",
  icon: Grid3X3,
  route: "/tools/sprite-slice",
  keywords: [...keywords, "切图", "识别", "导出"],
  status: "available",
  order: 80,
  acceptsPdf: false,
};

export const spritePackTool: ToolManifest = {
  id: "sprite-pack",
  title: "合成图集",
  description: "把多张图片装箱合成图集，支持分页、trim 和 TexturePacker JSON。",
  category: "assets",
  icon: Package,
  route: "/tools/sprite-pack",
  keywords: [...keywords, "合成", "装箱", "打包"],
  status: "available",
  order: 81,
  acceptsPdf: false,
};
