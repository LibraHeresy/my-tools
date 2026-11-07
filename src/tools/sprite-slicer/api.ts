import { invoke } from '@tauri-apps/api/core'
import type {
  DetectOptions,
  ExportOptions,
  ExportReport,
  JsonLayout,
  PackOptions,
  SheetInfo,
  SpriteRect,
} from './types'

// ───────────────────────────── 单张图集 ─────────────────────────────

export const openSheet = (path: string) => invoke<SheetInfo>('open_sheet', { path })

export const detectSprites = (opts: DetectOptions) =>
  invoke<SpriteRect[]>('detect_sprites', { opts })

/**
 * 导出切图。
 *
 * 传入的是**前端最终的**矩形列表——后端不会重新检测，否则界面上的修正会被覆盖。
 * 输出会落到 `<outRoot>/<源文件名>/` 这个专属子目录里；该目录若已存在本工具之外的文件，
 * 后端会整个中止（一个字节都不写），不会覆盖用户原有资源。
 */
export const exportSprites = (
  sprites: SpriteRect[],
  outRoot: string,
  exportOpts: ExportOptions,
) => invoke<ExportReport>('export_sprites', { sprites, outRoot, exportOpts })

// ───────────────────────────── 后台任务 ─────────────────────────────

/**
 * 打包：多张图 / 目录 → 一张图集。
 * 结果走 `pack-done` 事件（失败也走同一个事件，warnings 里带错误信息）。
 */
export const packImages = (
  inputs: string[],
  outDir: string,
  opts: PackOptions,
  layout: JsonLayout = 'array',
  recursive = true,
) => invoke<void>('pack_images', { inputs, outDir, opts, layout, recursive })

/**
 * 预览打包：在临时目录生成图集，只发 `pack-preview` 事件，不写正式输出目录。
 */
export const previewPack = (
  inputs: string[],
  opts: PackOptions,
  layout: JsonLayout = 'array',
  recursive = true,
) => invoke<void>('preview_pack', { inputs, opts, layout, recursive })

/**
 * 打包当前所有图：把界面上当前的矩形重新装箱成一张更紧凑的图集。
 *
 * **传的是前端那份矩形，后端不会重新检测。** 这是刻意的：
 * 用户在侧栏调过的参数、以及以后手动排除掉的噪点，都必须被尊重。
 */
export const repackSheet = (
  sprites: SpriteRect[],
  outDir: string,
  prefix: string,
  opts: PackOptions,
  layout: JsonLayout = 'array',
) => invoke<void>('repack_sheet', { sprites, outDir, prefix, opts, layout })

/**
 * 读"文件列表"：每行一个路径的 txt，或 JSON 字符串数组。
 *
 * 界面上暂时没有入口，但命令保留着，需要脚本化喂路径时可以直接调用。
 */
export const readPathList = (path: string) => invoke<string[]>('read_path_list', { path })

export type { PackSummary } from './types'
