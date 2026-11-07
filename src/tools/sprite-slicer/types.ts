export interface SheetInfo {
  path: string
  fileName: string
  width: number
  height: number
}

export interface SpriteRect {
  id: number
  x: number
  y: number
  w: number
  h: number
  pixels: number
  excluded: boolean
}

export type Connectivity = 'four' | 'eight'

/** 与 Rust 侧 slicer_io::SliceOptions 一一对应（serde camelCase）。 */
export interface DetectOptions {
  alphaThreshold: number
  connectivity: Connectivity
  minArea: number
  minSize: number
  erodeIterations: number
  mergeGap: number
  padding: number
}

/** 与 Rust 侧 slicer_io::ExportResult 对应。 */
export interface ExportReport {
  dir: string
  written: number
  skipped: number
  manifestPath: string
}

// ───────────────────────────── 导出命名 ─────────────────────────────

/** 与 Rust 侧 slicer_io::ExportOptions 对应。 */
export interface ExportOptions {
  /** 切图文件名前缀 */
  prefix: string
  /** 序号位数（补零） */
  digits: number
}

// ───────────────────────────── 打包 ─────────────────────────────

export type PackSort = 'area' | 'maxSide' | 'height' | 'width' | 'name' | 'none'
export type JsonLayout = 'array' | 'hash'

/** 与 Rust 侧 slicer_io::PackOptions 对应。 */
export interface PackOptions {
  padding: number
  extrude: number
  trim: boolean
  maxSize: number
  baseName: string
  sort: PackSort
}

export interface PageInfo {
  imageName: string
  width: number
  height: number
  frames: number
}

export interface PackSummary {
  outDir: string
  pages: PageInfo[]
  frameCount: number
  written: string[]
  warnings: string[]
  elapsedMs: number
}

// ───────────────────────────── 默认值 ─────────────────────────────

export const DEFAULT_OPTIONS: DetectOptions = {
  alphaThreshold: 1,
  connectivity: 'eight',
  minArea: 4,
  minSize: 1,
  erodeIterations: 0,
  mergeGap: 0,
  padding: 0,
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  prefix: 'sprite_',
  digits: 4,
}

export const DEFAULT_PACK_OPTIONS: PackOptions = {
  padding: 2,
  extrude: 1,
  trim: true,
  maxSize: 4096,
  baseName: 'atlas',
  sort: 'area',
}
