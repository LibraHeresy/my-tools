import { Grid3X3 } from "lucide-react";
import type { ToolManifest } from "../types";

export const spriteSlicerTool: ToolManifest = {
  id: "sprite-slicer",
  title: "精灵图工具",
  description:
    "自动切分 PNG 精灵图集，或把多张图片打包成图集，并生成 TexturePacker JSON。",
  category: "assets",
  icon: Grid3X3,
  route: "/tools/sprite-slicer",
  keywords: [
    "sprite",
    "spritesheet",
    "精灵图",
    "图集",
    "切图",
    "打包",
    "texturepacker",
    "游戏素材",
  ],
  status: "available",
  order: 80,
  acceptsPdf: false,
};
