import { useEffect, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Eye,
  FolderInput,
  Grid2X2,
  Image as ImageIcon,
  ImagePlus,
  LoaderCircle,
  Package,
  RefreshCw,
  Scissors,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useHashRoute } from '../../lib/router'
import { truncateMiddle } from '../../lib/format'
import { SpriteCanvas } from './components/SpriteCanvas'
import { JobPanel, type JobState } from './components/JobPanel'
import { detectSprites, exportSprites, openSheet, packImages, previewPack, repackSheet } from './api'
import {
  DEFAULT_EXPORT_OPTIONS,
  DEFAULT_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  type DetectOptions,
  type ExportOptions,
  type PackOptions,
  type PackSummary,
  type SheetInfo,
  type SpriteRect,
} from './types'
import '../../styles/sprite.css'

type NumericKey =
  | 'alphaThreshold'
  | 'minArea'
  | 'minSize'
  | 'erodeIterations'
  | 'mergeGap'
  | 'padding'

interface Field {
  key: NumericKey
  label: string
  min: number
  max: number
  step: number
  hint: string
}

const FIELDS: Field[] = [
  { key: 'minArea', label: '最小像素数', min: 0, max: 512, step: 1, hint: '过滤零星噪点' },
  { key: 'minSize', label: '最小边长', min: 0, max: 128, step: 1, hint: '过滤细长杂线' },
  { key: 'mergeGap', label: '合并间隔', min: 0, max: 32, step: 1, hint: '间隔小于此值的框会被合并' },
  { key: 'padding', label: '导出外扩', min: 0, max: 32, step: 1, hint: '导出时四周各扩几像素' },
]

type PackNumericKey = 'padding' | 'extrude' | 'maxSize'

const PACK_FIELDS: { key: PackNumericKey; label: string; min: number; max: number; step: number; hint: string }[] = [
  { key: 'padding', label: '精灵间隔', min: 0, max: 16, step: 1, hint: '相邻精灵之间的最小间距' },
  { key: 'extrude', label: '边缘外扩', min: 0, max: 4, step: 1, hint: '建议 ≥1，否则边缘会出现黑边' },
  { key: 'maxSize', label: '单页上限', min: 256, max: 8192, step: 256, hint: '放不下会自动分页' },
]

interface SavedDetectPreset {
  id: string
  name: string
  options: DetectOptions
}

const SPRITE_PRESETS_KEY = 'pdf-workbench:sprite-presets:v1'

function loadSavedPresets(): SavedDetectPreset[] {
  try {
    const raw = window.localStorage.getItem(SPRITE_PRESETS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is SavedDetectPreset =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as SavedDetectPreset).id === 'string' &&
            typeof (item as SavedDetectPreset).name === 'string' &&
            (item as SavedDetectPreset).options &&
            typeof (item as SavedDetectPreset).options === 'object',
        ),
    )
  } catch {
    return []
  }
}

interface PackPreset {
  id: string
  label: string
  hint: string
  padding: number
  extrude: number
}

const PACK_PRESETS: PackPreset[] = [
  { id: 'compact', label: '紧凑', hint: '尽量省空间', padding: 1, extrude: 1 },
  { id: 'balanced', label: '平衡', hint: '日常默认', padding: 2, extrude: 1 },
  { id: 'roomy', label: '留边', hint: '边缘更宽松', padding: 4, extrude: 2 },
]

async function pickFiles(title: string): Promise<string[] | null> {
  const picked = await openDialog({
    multiple: true,
    title,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  })
  if (!picked) return null
  return Array.isArray(picked) ? picked : [picked]
}

/** 多选文件夹。展开时是**递归**的，所以子目录里的图集也会被收进来。 */
async function pickDirs(title: string): Promise<string[] | null> {
  const picked = await openDialog({ directory: true, multiple: true, title })
  if (!picked) return null
  return Array.isArray(picked) ? picked : [picked]
}

async function pickDir(title: string): Promise<string | null> {
  const dir = await openDialog({ directory: true, title })
  return typeof dir === 'string' ? dir : null
}

function pathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp)$/i.test(path)
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, '')}\\${name}`
}

function SpriteThumb({ imageUrl, sprite }: { imageUrl: string; sprite: SpriteRect }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    let cancelled = false
    const image = new window.Image()
    image.onload = () => {
      if (cancelled) return
      const scale = Math.min(220 / sprite.w, 140 / sprite.h)
      const width = sprite.w * scale
      const height = sprite.h * scale
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.imageSmoothingEnabled = true
      context.drawImage(
        image,
        sprite.x,
        sprite.y,
        sprite.w,
        sprite.h,
        (canvas.width - width) / 2,
        (canvas.height - height) / 2,
        width,
        height,
      )
    }
    image.src = imageUrl
    return () => {
      cancelled = true
      image.onload = null
    }
  }, [imageUrl, sprite])

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={160}
      className="sprite-result-canvas"
      aria-hidden="true"
    />
  )
}

function hoverPreviewSize(sprite: SpriteRect) {
  const maxWidth = 300
  const maxHeight = 240
  const scale = Math.min(maxWidth / sprite.w, maxHeight / sprite.h)
  return {
    width: Math.max(1, Math.round(sprite.w * scale)),
    height: Math.max(1, Math.round(sprite.h * scale)),
  }
}

function HoverSprite({ imageUrl, sprite }: { imageUrl: string; sprite: SpriteRect }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { width, height } = hoverPreviewSize(sprite)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * ratio))
    canvas.height = Math.max(1, Math.round(height * ratio))
    let cancelled = false
    const image = new window.Image()
    image.onload = () => {
      if (cancelled) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      context.imageSmoothingEnabled = true
      context.drawImage(
        image,
        sprite.x,
        sprite.y,
        sprite.w,
        sprite.h,
        0,
        0,
        width,
        height,
      )
    }
    image.src = imageUrl
    return () => {
      cancelled = true
      image.onload = null
    }
  }, [imageUrl, sprite, width, height])

  return (
    <canvas
      ref={canvasRef}
      className="sprite-hover-canvas"
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}

function App() {
  const { navigate } = useHashRoute()
  const [mode, setMode] = useState<'slice' | 'pack'>('slice')
  const [sheet, setSheet] = useState<SheetInfo | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [sprites, setSprites] = useState<SpriteRect[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [hoverPreview, setHoverPreview] = useState<{
    sprite: SpriteRect
    x: number
    y: number
  } | null>(null)
  const [opts, setOpts] = useState<DetectOptions>(DEFAULT_OPTIONS)
  const [exportOpts, setExportOpts] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS)
  const [packOpts, setPackOpts] = useState<PackOptions>(DEFAULT_PACK_OPTIONS)
  const [showLabels, setShowLabels] = useState(true)
  const [nonce, setNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [job, setJob] = useState<JobState | null>(null)
  const [dragging, setDragging] = useState(false)
  const [packInputs, setPackInputs] = useState<string[]>([])
  const [packPreviewOpen, setPackPreviewOpen] = useState(false)
  const [packPreview, setPackPreview] = useState<PackSummary | null>(null)
  const [packPreviewPage, setPackPreviewPage] = useState(0)
  const [packPreviewBusy, setPackPreviewBusy] = useState(false)
  const [packHover, setPackHover] = useState<{
    path: string
    name: string
    x: number
    y: number
  } | null>(null)
  const [savedPresets, setSavedPresets] = useState<SavedDetectPreset[]>(loadSavedPresets)
  const [presetName, setPresetName] = useState('')

  // 拖拽：合成模式追加输入；切图模式只接受单张 PNG，不再批量处理。
  const dropRunner = useRef<(inputs: string[]) => void>(() => {})
  dropRunner.current = (inputs: string[]) => {
    if (mode === 'pack') {
      addPackInputs(inputs)
      setMessage(`已添加 ${inputs.length} 个输入到合成列表。`)
      return
    }
    if (
      inputs.length === 1 &&
      inputs[0].toLowerCase().endsWith('.png')
    ) {
      void loadSheet(inputs[0])
      return
    }
    setError('已移除批量切图，请一次拖入一张 PNG 图集。')
  }

  // 参数一改就自动重跑（debounce 200ms）。检测本身只要几十毫秒，所以体验是即时的。
  useEffect(() => {
    if (!sheet) return
    let cancelled = false
    setBusy(true)
    const timer = setTimeout(async () => {
      try {
        const found = await detectSprites(opts)
        if (cancelled) return
        setSprites(found)
        setError(null)
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setBusy(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
      setBusy(false)
    }
  }, [sheet, opts, nonce])

  // 后台任务的事件监听。任务本身立刻返回，结果全靠事件送回来。
  useEffect(() => {
    const unlisteners: Array<() => void> = []
    let cancelled = false

    void listen<PackSummary>('pack-done', (event) => {
      setJob({
        kind: 'pack',
        running: false,
        label: '',
        done: 1,
        total: 1,
        packSummary: event.payload,
      })
    }).then((handle) => {
      if (cancelled) handle()
      else unlisteners.push(handle)
    })

    void listen<PackSummary>('pack-preview', (event) => {
      setPackPreview(event.payload)
      setPackPreviewPage(0)
      setPackPreviewBusy(false)
      setPackPreviewOpen(true)
    }).then((handle) => {
      if (cancelled) handle()
      else unlisteners.push(handle)
    })

    return () => {
      cancelled = true
      unlisteners.forEach((un) => un())
    }
  }, [])

  // 拖拽进窗口只用于合成模式追加输入；切图模式不再处理批量拖拽。
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false

    void (async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview')
        const un = await getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === 'over') setDragging(true)
          else if (event.payload.type === 'drop') {
            setDragging(false)
            const paths = event.payload.paths
            if (paths.length > 0) dropRunner.current(paths)
          } else setDragging(false)
        })
        if (disposed) un()
        else unlisten = un
      } catch (e) {
        // 拖拽不可用不该影响其它功能
        console.warn('拖拽事件不可用：', e)
      }
    })()

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  useEffect(() => {
    setSelectedIds((current) =>
      current.filter((id) => sprites.some((sprite) => sprite.id === id)),
    )
  }, [sprites])

  useEffect(() => {
    if (!previewOpen && !packPreviewOpen) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewOpen(false)
        setPackPreviewOpen(false)
        setHoverPreview(null)
        setPackHover(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [previewOpen, packPreviewOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(SPRITE_PRESETS_KEY, JSON.stringify(savedPresets))
    } catch {
      // localStorage 不可用时只影响预设持久化，不影响切图
    }
  }, [savedPresets])

  async function loadSheet(path: string) {
    try {
      setBusy(true)
      const info = await openSheet(path)
      setSheet(info)
      setImageUrl(convertFileSrc(path))
      setSprites([])
      setSelectedIds([])
      setError(null)
      setMessage(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleOpen() {
    const picked = await pickFiles('选择精灵图集（PNG）')
    if (!picked || picked.length === 0) return
    await loadSheet(picked[0])
  }

  async function handleExport() {
    if (!sheet || sprites.length === 0) return
    const targets =
      selectedIds.length > 0
        ? sprites.filter((sprite) => selectedIds.includes(sprite.id))
        : sprites
    if (targets.length === 0) return
    const dir = await pickDir('选择导出目录')
    if (!dir) return
    try {
      const report = await exportSprites(targets, dir, exportOpts)
      setError(null)
      setMessage(
        selectedIds.length > 0
          ? `已导出选中的 ${report.written} 张切图（跳过 ${report.skipped} 张）→ ${report.dir}`
          : `已导出 ${report.written} 张切图（跳过 ${report.skipped} 张）→ ${report.dir}`,
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  function addPackInputs(paths: string[]) {
    setPackInputs((current) => {
      const next = [...current]
      for (const path of paths) {
        if (!next.includes(path)) next.push(path)
      }
      return next
    })
    setError(null)
  }

  async function handleAddPackFiles() {
    const inputs = await pickFiles('选择要合成图集的图片（可多选）')
    if (!inputs) return
    addPackInputs(inputs)
    setMessage(`已添加 ${inputs.length} 个输入到合成列表。`)
  }

  async function handleAddPackFolders() {
    const dirs = await pickDirs('选择要合成图集的文件夹（可多选，含子文件夹）')
    if (!dirs) return
    addPackInputs(dirs)
    setMessage(`已添加 ${dirs.length} 个输入到合成列表。`)
  }

  function handleClearPackInputs() {
    setPackInputs([])
    setMessage(null)
  }

  function handleRemovePackInput(path: string) {
    setPackInputs((current) => current.filter((item) => item !== path))
  }

  async function handlePreviewPack() {
    if (packInputs.length === 0) {
      setError('请先选择要合成图集的图片或文件夹。')
      return
    }
    setError(null)
    setPackPreviewBusy(true)
    try {
      await previewPack(packInputs, packOpts)
    } catch (e) {
      setPackPreviewBusy(false)
      setError(String(e))
    }
  }

  async function handleStartPack() {
    if (packInputs.length === 0) {
      setError('请先选择要合成图集的图片或文件夹。')
      return
    }
    const outDir = await pickDir('选择图集输出目录')
    if (!outDir) return
    setMessage(null)
    setError(null)
    setJob({
      kind: 'pack',
      running: true,
      label: `${packInputs.length} 个输入`,
      done: 0,
      total: 1,
    })
    try {
      await packImages(packInputs, outDir, packOpts)
    } catch (e) {
      setError(String(e))
      setJob(null)
    }
  }

  function handleSavePreset() {
    const name = presetName.trim()
    if (!name) {
      setError('请先输入预设名称。')
      return
    }
    setSavedPresets((current) => {
      const existing = current.find((preset) => preset.name === name)
      if (existing) {
        return current.map((preset) =>
          preset.id === existing.id ? { ...preset, options: { ...opts } } : preset,
        )
      }
      return [
        ...current,
        {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          name,
          options: { ...opts },
        },
      ]
    })
    setPresetName('')
    setError(null)
    setMessage(`已保存预设“${name}”。`)
  }

  function handleApplyPreset(preset: SavedDetectPreset) {
    setOpts({ ...preset.options })
    setError(null)
    setMessage(`已应用预设“${preset.name}”。`)
  }

  function handleDeletePreset(id: string) {
    setSavedPresets((current) => current.filter((preset) => preset.id !== id))
  }

  async function handleRepackSheet() {
    if (!sheet) {
      setError('还没有打开图集')
      return
    }
    const included = sprites.filter((s) => !s.excluded)
    if (included.length === 0) {
      setError('当前没有可重排的精灵')
      return
    }

    const outDir = await pickDir('选择重排后的图集输出目录')
    if (!outDir) return

    setJob({
      kind: 'pack',
      running: true,
      label: `重排 ${included.length} 个精灵（用界面上的当前结果，不重新检测）`,
      done: 0,
      total: 1,
    })
    try {
      // 传的是界面上的矩形，不是图片路径——后端不会重新检测，
      // 所以侧栏调过的参数与被排除的噪点都会被尊重
      await repackSheet(sprites, outDir, exportOpts.prefix, packOpts)
    } catch (e) {
      setError(String(e))
      setJob(null)
    }
  }

  const total = sprites.length
  const selectedCount = selectedIds.length
  const excludedCount = sprites.filter((s) => s.excluded).length
  const canExport = Boolean(sheet) && total > 0 && !busy

  function toggleSelected(id: number) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    )
  }

  function clearSelection() {
    setSelectedIds([])
  }

  const activePackPreset =
    PACK_PRESETS.find(
      (preset) =>
        packOpts.padding === preset.padding &&
        packOpts.extrude === preset.extrude &&
        packOpts.trim,
    )?.id ?? null

  const handleBack = () => {
    if (job?.running) return
    navigate('/')
  }

  const switchMode = (next: 'slice' | 'pack') => {
    if (job?.running) return
    setMode(next)
    setError(null)
    setMessage(null)
  }

  return (
    <div className={`tool-page sprite-page ${sheet || packInputs.length > 0 ? 'has-file' : ''}`}>
      <div className="page-topbar">
        <button
          type="button"
          className="back-button"
          onClick={handleBack}
          disabled={Boolean(job?.running)}
        >
          <ArrowLeft size={15} />
          全部工具
        </button>
        <span className="breadcrumb-slash">/</span>
        <span className="breadcrumb-current">精灵图工具</span>
        <span className="topbar-spacer" />
        <span className="local-chip">
          <ShieldCheck size={14} />
          本地处理
        </span>
      </div>

      <header className="tool-heading">
        <div>
          <span className="eyebrow">素材</span>
          <h1>精灵图工具</h1>
          <p>识别图集里的精灵并切图，或把多张图片合成一张图集。</p>
        </div>
        {mode === 'slice' && sheet ? (
          <span className="loaded-chip">
            <span className="loaded-dot" />
            {busy ? '识别中' : `已识别 ${total} 个精灵`}
          </span>
        ) : mode === 'pack' && packInputs.length > 0 ? (
          <span className="loaded-chip">
            <span className="loaded-dot" />
            已选择 {packInputs.length} 个输入
          </span>
        ) : null}
      </header>

      <div className="sprite-mode-switch" role="tablist" aria-label="精灵图工具模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'slice'}
          className={`sprite-mode-tab ${mode === 'slice' ? 'is-active' : ''}`}
          onClick={() => switchMode('slice')}
          disabled={Boolean(job?.running)}
        >
          <Scissors size={17} />
          <span>
            <strong>切图</strong>
            <small>识别图集并导出精灵</small>
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'pack'}
          className={`sprite-mode-tab ${mode === 'pack' ? 'is-active' : ''}`}
          onClick={() => switchMode('pack')}
          disabled={Boolean(job?.running)}
        >
          <Package size={17} />
          <span>
            <strong>合成图集</strong>
            <small>把多张图片装箱成图集</small>
          </span>
        </button>
      </div>

      {error ? (
        <div className="inline-alert page-alert" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
          <button
            type="button"
            className="alert-close"
            aria-label="关闭错误提示"
            onClick={() => setError(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {message ? (
        <div className="inline-notice page-alert" role="status">
          <ImageIcon size={15} />
          <span>{message}</span>
          <button
            type="button"
            className="alert-close"
            aria-label="关闭提示"
            onClick={() => setMessage(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {mode === 'slice' ? (
        !sheet ? (
          <section className="sprite-empty">
            <div className="sprite-empty-art" aria-hidden="true">
              <span className="sprite-empty-tile tile-a" />
              <span className="sprite-empty-tile tile-b" />
              <span className="sprite-empty-tile tile-c" />
              <span className="sprite-empty-badge">
                <Grid2X2 size={22} />
              </span>
            </div>
            <span className="eyebrow">PNG 精灵图集</span>
            <h2>把图集拖进来</h2>
            <p>
              自动识别每个精灵的边界，导出切图和 TexturePacker JSON。
            </p>
            <div className="sprite-empty-actions">
              <button type="button" className="btn btn-primary" onClick={handleOpen}>
                <ImagePlus size={17} />
                选择 PNG 图集
              </button>
            </div>
            <div className="sprite-empty-links">
              <span>支持透明 PNG · 全部在本机处理</span>
            </div>
          </section>
        ) : (
          <>
            <div className="sprite-filebar">
              <span className="sprite-file-icon">
                <ImageIcon size={18} />
              </span>
              <div className="sprite-file-copy">
                <strong>{sheet.fileName}</strong>
                <span>
                  {sheet.width} × {sheet.height} · {busy ? '正在识别' : `${total} 个精灵`}
                  {excludedCount > 0 ? ` · 已排除 ${excludedCount} 个` : ''}
                </span>
              </div>
              <span className="sprite-file-path" title={sheet.path}>
                {truncateMiddle(sheet.path, 42)}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={handleOpen}
                disabled={busy}
              >
                <RefreshCw size={14} />
                更换图集
              </button>
            </div>

            <div className="sprite-slice-layout">
              <section className="sprite-canvas-panel">
                <header className="sprite-panel-head">
                  <div>
                    <span className="panel-kicker">预览</span>
                    <h2>图集</h2>
                  </div>
                  <div className="sprite-panel-tools">
                    <label className="sprite-switch">
                      <input
                        type="checkbox"
                        checked={showLabels}
                        onChange={(event) => setShowLabels(event.target.checked)}
                      />
                      <span className="sprite-switch-box" aria-hidden="true" />
                      显示编号
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-compact"
                      onClick={handleRepackSheet}
                      disabled={total === 0 || busy}
                    >
                      <Grid2X2 size={14} />
                      重排当前
                    </button>
                    <button
                      type="button"
                      className="text-button sprite-refresh"
                      onClick={() => setNonce((value) => value + 1)}
                      disabled={busy}
                    >
                      <RefreshCw size={13} />
                      重新识别
                    </button>
                  </div>
                </header>

                <div className="sprite-stage">
                  {imageUrl ? (
                    <SpriteCanvas
                      imageUrl={imageUrl}
                      sheetW={sheet.width}
                      sheetH={sheet.height}
                      sprites={sprites}
                      selectedIds={selectedIds}
                      onToggleSelect={toggleSelected}
                      onClearSelection={clearSelection}
                      showLabels={showLabels}
                    />
                  ) : (
                    <div className="sprite-stage-loading">
                      <LoaderCircle size={18} className="spin" />
                      正在载入图集…
                    </div>
                  )}
                  {busy ? (
                    <div className="sprite-busy">
                      <LoaderCircle size={14} className="spin" />
                      正在识别精灵
                    </div>
                  ) : null}
                </div>

                <footer className="sprite-canvas-foot">
                  <span>滚轮缩放 · 拖动平移 · 点击选中或取消</span>
                  <span>
                    {total} 个精灵
                    {selectedCount > 0 ? ` · 已选 ${selectedCount} 个` : ''}
                    {excludedCount > 0 ? ` · 排除 ${excludedCount} 个` : ''}
                  </span>
                </footer>
              </section>

              <div className="sprite-right-column">
                <section className="sprite-export-card" aria-label="导出切图">
                  <header className="sprite-export-card-head">
                    <div>
                      <span className="panel-kicker">导出</span>
                      <h2>导出切图</h2>
                    </div>
                    <span className="count-chip">
                      {selectedCount > 0 ? `已选 ${selectedCount}` : `全部 ${total}`}
                    </span>
                  </header>

                  <label className="sprite-export-field">
                    <span>文件名前缀</span>
                    <input
                      className="text-input"
                      type="text"
                      value={exportOpts.prefix}
                      placeholder="sprite_"
                      onChange={(event) =>
                        setExportOpts((previous) => ({
                          ...previous,
                          prefix: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <label className="sprite-export-field">
                    <span>序号位数</span>
                    <input
                      className="text-input"
                      type="number"
                      min={1}
                      max={8}
                      value={exportOpts.digits}
                      onChange={(event) =>
                        setExportOpts((previous) => ({
                          ...previous,
                          digits: Math.min(
                            8,
                            Math.max(1, Number(event.target.value) || 1),
                          ),
                        }))
                      }
                    />
                  </label>

                  <div className="sprite-export-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setPreviewOpen(true)}
                      disabled={total === 0}
                    >
                      <Eye size={15} />
                      预览
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleExport}
                      disabled={!canExport}
                    >
                      <Download size={15} />
                      导出
                    </button>
                  </div>

                  <p className="sprite-export-note">
                    {selectedCount > 0
                      ? `只导出已选的 ${selectedCount} 个精灵。`
                      : '未选择时导出全部精灵。'}
                  </p>
                </section>

                <aside className="sprite-param-panel" aria-label="调整识别参数">
                  <header className="sprite-settings-head">
                    <div>
                      <span className="panel-kicker">调整</span>
                      <h2>识别参数</h2>
                    </div>
                    <span className="count-chip">{total} 个精灵</span>
                  </header>

                  <div className="sprite-param-body">
                    <section className="sprite-section">
                      <div className="sprite-section-head">
                        <span className="field-label">参数预设</span>
                      </div>
                      <div className="sprite-preset-save">
                        <input
                          className="text-input"
                          type="text"
                          value={presetName}
                          placeholder="预设名称"
                          onChange={(event) => setPresetName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') handleSavePreset()
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-compact"
                          onClick={handleSavePreset}
                          disabled={!presetName.trim()}
                        >
                          保存当前
                        </button>
                      </div>
                      {savedPresets.length === 0 ? (
                        <p className="field-hint">保存当前参数后，可以在这里快速套用。</p>
                      ) : (
                        <ul className="sprite-saved-list">
                          {savedPresets.map((preset) => (
                            <li key={preset.id}>
                              <button
                                type="button"
                                className="sprite-saved-apply"
                                onClick={() => handleApplyPreset(preset)}
                                title={`应用预设 ${preset.name}`}
                              >
                                <strong>{preset.name}</strong>
                                <small>
                                  最小像素 {preset.options.minArea} · 合并{' '}
                                  {preset.options.mergeGap}
                                </small>
                              </button>
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={`删除预设 ${preset.name}`}
                                onClick={() => handleDeletePreset(preset.id)}
                              >
                                <X size={12} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="sprite-section">
                      <div className="sprite-section-head">
                        <span className="field-label">识别参数</span>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setOpts({ ...DEFAULT_OPTIONS })}
                        >
                          恢复默认
                        </button>
                      </div>

                      {FIELDS.map((field) => (
                        <div className="sprite-field" key={field.key}>
                          <div className="sprite-field-head">
                            <label htmlFor={`sprite-param-${field.key}`}>
                              {field.label}
                            </label>
                            <span>{opts[field.key]}</span>
                          </div>
                          <input
                            id={`sprite-param-${field.key}`}
                            type="range"
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            value={opts[field.key]}
                            onChange={(event) =>
                              setOpts((previous) => ({
                                ...previous,
                                [field.key]: Number(event.target.value),
                              }))
                            }
                          />
                          <p className="field-hint">{field.hint}</p>
                        </div>
                      ))}

                      <label className="sprite-select-row">
                        <span>连通性</span>
                        <select
                          value={opts.connectivity}
                          onChange={(event) =>
                            setOpts((previous) => ({
                              ...previous,
                              connectivity: event.target
                                .value as DetectOptions['connectivity'],
                            }))
                          }
                        >
                          <option value="eight">8 邻域（含对角）</option>
                          <option value="four">4 邻域（不含对角）</option>
                        </select>
                      </label>

                      <p className="field-hint">修改参数后会自动重新识别。</p>
                    </section>
                  </div>
                </aside>
              </div>
            </div>

            {previewOpen ? (
              <div
                className="sprite-preview-backdrop"
                onClick={() => {
                  setPreviewOpen(false)
                  setHoverPreview(null)
                }}
              >
                <section
                  className="sprite-preview-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="sprite-preview-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <header className="sprite-preview-head">
                    <div>
                      <span className="panel-kicker">预览</span>
                      <h2 id="sprite-preview-title">识别结果</h2>
                    </div>
                    <div className="sprite-preview-head-meta">
                      <span className="count-chip">
                        {selectedCount > 0 ? `已选 ${selectedCount} / ${total}` : `全部 ${total}`}
                      </span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="关闭识别结果预览"
                        onClick={() => {
                          setPreviewOpen(false)
                          setHoverPreview(null)
                        }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </header>

                  <p className="sprite-preview-note">
                    点击预览图切换导出范围；再次点击可以取消选中。未选择时导出全部。
                  </p>

                  <div className="sprite-preview-grid">
                    {sprites.map((sprite) => (
                      <button
                        type="button"
                        key={sprite.id}
                        className={`sprite-preview-card ${
                          selectedIds.includes(sprite.id) ? 'is-selected' : ''
                        }`}
                        onClick={() => toggleSelected(sprite.id)}
                        onMouseEnter={(event) =>
                          setHoverPreview({
                            sprite,
                            x: event.clientX,
                            y: event.clientY,
                          })
                        }
                        onMouseMove={(event) =>
                          setHoverPreview({
                            sprite,
                            x: event.clientX,
                            y: event.clientY,
                          })
                        }
                        onMouseLeave={() => setHoverPreview(null)}
                      >
                        <span className="sprite-preview-thumb">
                          {imageUrl ? (
                            <SpriteThumb imageUrl={imageUrl} sprite={sprite} />
                          ) : null}
                        </span>
                        <span className="sprite-preview-label">
                          <strong>#{sprite.id}</strong>
                          <span>
                            {sprite.w} × {sprite.h}
                          </span>
                        </span>
                        {selectedIds.includes(sprite.id) ? (
                          <span className="sprite-preview-check" aria-hidden="true">
                            ✓
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>

                  <footer className="sprite-preview-foot">
                    <button
                      type="button"
                      className="text-button"
                      onClick={clearSelection}
                      disabled={selectedCount === 0}
                    >
                      清空选择
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => {
                        setPreviewOpen(false)
                        setHoverPreview(null)
                      }}
                    >
                      关闭
                    </button>
                  </footer>
                </section>

                {hoverPreview ? (
                  <div
                    className="sprite-hover-preview"
                    style={{
                      left: Math.min(
                        hoverPreview.x + 18,
                        window.innerWidth - hoverPreviewSize(hoverPreview.sprite).width - 30,
                      ),
                      top: Math.min(
                        hoverPreview.y + 18,
                        window.innerHeight - hoverPreviewSize(hoverPreview.sprite).height - 42,
                      ),
                    }}
                  >
                    <HoverSprite imageUrl={imageUrl ?? ''} sprite={hoverPreview.sprite} />
                    <span>
                      #{hoverPreview.sprite.id} · {hoverPreview.sprite.w} ×{' '}
                      {hoverPreview.sprite.h}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )
      ) : (
        <>
        <div className="sprite-slice-layout">
          <section className="sprite-canvas-panel sprite-pack-input-panel">
            <header className="sprite-panel-head">
              <div>
                <span className="panel-kicker">输入</span>
                <h2>合成图集</h2>
              </div>
              <div className="sprite-pack-input-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={handleAddPackFiles}
                >
                  添加图片
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={handleAddPackFolders}
                >
                  添加文件夹
                </button>
                {packInputs.length > 0 ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={handleClearPackInputs}
                  >
                    清空
                  </button>
                ) : null}
              </div>
            </header>

            <div
              className={`sprite-pack-preview-body ${
                packInputs.length === 0 ? 'is-empty' : ''
              }`}
            >
              {packInputs.length === 0 ? (
                <div className="sprite-pack-empty">
                  <span className="sprite-pack-empty-icon">
                    <Package size={24} />
                  </span>
                  <h3>选择要合成的图片</h3>
                  <p>
                    可以选多张图片，也可以选文件夹递归收集其中的图片。
                    松手拖入窗口同样有效。
                  </p>
                  <div className="sprite-empty-actions">
                    <button type="button" className="btn btn-primary" onClick={handleAddPackFiles}>
                      <ImagePlus size={17} />
                      选择图片
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={handleAddPackFolders}>
                      <FolderInput size={17} />
                      选择文件夹
                    </button>
                  </div>
                  <span className="sprite-pack-hint">支持 PNG</span>
                </div>
              ) : (
                <div className="sprite-pack-thumb-grid">
                  {packInputs.map((path) => {
                    const image = isImagePath(path)
                    return (
                      <div
                        className="sprite-pack-thumb"
                        key={path}
                        onMouseEnter={(event) => {
                          if (!image) return
                          setPackHover({
                            path,
                            name: pathName(path),
                            x: event.clientX,
                            y: event.clientY,
                          })
                        }}
                        onMouseMove={(event) => {
                          if (!image) return
                          setPackHover({
                            path,
                            name: pathName(path),
                            x: event.clientX,
                            y: event.clientY,
                          })
                        }}
                        onMouseLeave={() => setPackHover(null)}
                      >
                        <span className="sprite-pack-thumb-media">
                          {image ? (
                            <img src={convertFileSrc(path)} alt="" />
                          ) : (
                            <FolderInput size={24} />
                          )}
                        </span>
                        <span className="sprite-pack-thumb-name" title={path}>
                          {pathName(path)}
                        </span>
                        <button
                          type="button"
                          className="sprite-pack-thumb-remove"
                          aria-label={`移除 ${pathName(path)}`}
                          onClick={() => handleRemovePackInput(path)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <footer className="sprite-canvas-foot">
              <span>悬浮图片可以看大图 · 点击右上角移除</span>
              <span>{packInputs.length} 个输入</span>
            </footer>
          </section>

          <div className="sprite-right-column">
            <section className="sprite-export-card" aria-label="合成图集">
              <header className="sprite-export-card-head">
                <div>
                  <span className="panel-kicker">合成</span>
                  <h2>合成图集</h2>
                </div>
                <span className="count-chip">{packInputs.length} 个输入</span>
              </header>

              <label className="sprite-export-field">
                <span>图集文件名</span>
                <input
                  className="text-input"
                  type="text"
                  value={packOpts.baseName}
                  placeholder="atlas"
                  onChange={(event) =>
                    setPackOpts((previous) => ({
                      ...previous,
                      baseName: event.target.value,
                    }))
                  }
                />
              </label>

              <div className="sprite-export-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handlePreviewPack}
                  disabled={packInputs.length === 0 || packPreviewBusy}
                >
                  {packPreviewBusy ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <Eye size={15} />
                  )}
                  {packPreviewBusy ? '合成中' : '预览'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleStartPack}
                  disabled={packInputs.length === 0 || Boolean(job?.running)}
                >
                  <Download size={15} />
                  导出
                </button>
              </div>

              <p className="sprite-export-note">
                预览只生成临时图集，不写盘；导出会写入所选目录，并生成 PNG + JSON。
              </p>
            </section>

            <aside className="sprite-param-panel" aria-label="装箱参数">
              <header className="sprite-settings-head">
                <div>
                  <span className="panel-kicker">调整</span>
                  <h2>装箱参数</h2>
                </div>
                <span className="count-chip">{packInputs.length} 个输入</span>
              </header>

              <div className="sprite-param-body">
                <section className="sprite-section">
                  <div className="sprite-section-head">
                    <span className="field-label">按风格选择</span>
                  </div>
                  <div className="sprite-preset-grid sprite-preset-grid-3">
                    {PACK_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`sprite-preset ${
                          activePackPreset === preset.id ? 'is-active' : ''
                        }`}
                        onClick={() =>
                          setPackOpts((previous) => ({
                            ...previous,
                            padding: preset.padding,
                            extrude: preset.extrude,
                            trim: true,
                          }))
                        }
                      >
                        <strong>{preset.label}</strong>
                        <small>{preset.hint}</small>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="sprite-section">
                  <div className="sprite-section-head">
                    <span className="field-label">装箱参数</span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setPackOpts({
                          ...DEFAULT_PACK_OPTIONS,
                          baseName: packOpts.baseName,
                        })
                      }
                    >
                      恢复默认
                    </button>
                  </div>

                  {PACK_FIELDS.map((field) => (
                    <div className="sprite-field" key={field.key}>
                      <div className="sprite-field-head">
                        <label htmlFor={`pack-param-${field.key}`}>
                          {field.label}
                        </label>
                        <span>{packOpts[field.key]}</span>
                      </div>
                      <input
                        id={`pack-param-${field.key}`}
                        type="range"
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={packOpts[field.key]}
                        onChange={(event) =>
                          setPackOpts((previous) => ({
                            ...previous,
                            [field.key]: Number(event.target.value),
                          }))
                        }
                      />
                      <p className="field-hint">{field.hint}</p>
                    </div>
                  ))}

                  <label className="sprite-select-row">
                    <span>装箱排序</span>
                    <select
                      value={packOpts.sort}
                      onChange={(event) =>
                        setPackOpts((previous) => ({
                          ...previous,
                          sort: event.target.value as PackOptions['sort'],
                        }))
                      }
                    >
                      <option value="area">按面积</option>
                      <option value="maxSide">按最长边</option>
                      <option value="height">按高度</option>
                      <option value="width">按宽度</option>
                      <option value="name">按文件名</option>
                      <option value="none">保持输入顺序</option>
                    </select>
                  </label>

                  <label className="sprite-check">
                    <input
                      type="checkbox"
                      checked={packOpts.trim}
                      onChange={(event) =>
                        setPackOpts((previous) => ({
                          ...previous,
                          trim: event.target.checked,
                        }))
                      }
                    />
                    <span>裁掉透明边并记录偏移</span>
                  </label>
                </section>
              </div>
            </aside>
          </div>
        </div>

        {packPreviewOpen ? (
          <div
            className="sprite-preview-backdrop"
            onClick={() => {
              setPackPreviewOpen(false)
              setPackHover(null)
            }}
          >
            <section
              className="sprite-preview-modal pack-preview-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pack-preview-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="sprite-preview-head">
                <div>
                  <span className="panel-kicker">预览</span>
                  <h2 id="pack-preview-title">图集预览</h2>
                </div>
                <div className="sprite-preview-head-meta">
                  <span className="count-chip">
                    {packPreview
                      ? `${packPreview.pages.length} 页 · ${packPreview.frameCount} 个精灵`
                      : '生成中'}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="关闭图集预览"
                    onClick={() => setPackPreviewOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </header>

              {packPreview && packPreview.pages.length > 0 ? (
                <>
                  <div className="pack-preview-stage">
                    <img
                      src={convertFileSrc(
                        joinPath(
                          packPreview.outDir,
                          packPreview.pages[packPreviewPage]?.imageName ??
                            packPreview.pages[0].imageName,
                        ),
                      )}
                      alt={`图集第 ${packPreviewPage + 1} 页`}
                    />
                  </div>
                  <div className="pack-preview-meta">
                    <span>
                      第 {packPreviewPage + 1} / {packPreview.pages.length} 页 ·{' '}
                      {packPreview.pages[packPreviewPage]?.width} ×{' '}
                      {packPreview.pages[packPreviewPage]?.height} · 用时{' '}
                      {packPreview.elapsedMs} ms
                    </span>
                    {packPreview.pages.length > 1 ? (
                      <div className="pack-preview-pager">
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          onClick={() =>
                            setPackPreviewPage((page) => Math.max(0, page - 1))
                          }
                          disabled={packPreviewPage === 0}
                        >
                          上一页
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-compact"
                          onClick={() =>
                            setPackPreviewPage((page) =>
                              Math.min(packPreview.pages.length - 1, page + 1),
                            )
                          }
                          disabled={packPreviewPage >= packPreview.pages.length - 1}
                        >
                          下一页
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {packPreview.warnings.length > 0 ? (
                    <div className="job-warnings pack-preview-warnings">
                      {packPreview.warnings.map((warning, index) => (
                        <div key={index}>⚠ {warning}</div>
                      ))}
                    </div>
                  ) : null}
                  <footer className="sprite-preview-foot">
                    <span className="field-hint">预览只生成临时图集，不会写入正式目录。</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => setPackPreviewOpen(false)}
                    >
                      关闭
                    </button>
                  </footer>
                </>
              ) : (
                <>
                  <div className="pack-preview-error">
                    {packPreview?.warnings.join('；') || '合成失败，请检查输入图片。'}
                  </div>
                  <footer className="sprite-preview-foot">
                    <span className="field-hint">未生成图集，请调整输入或参数后重试。</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={() => setPackPreviewOpen(false)}
                    >
                      关闭
                    </button>
                  </footer>
                </>
              )}
            </section>
          </div>
        ) : null}

        {packHover ? (
          <div
            className="sprite-hover-preview pack-hover-preview"
            style={{
              left: Math.min(packHover.x + 18, window.innerWidth - 324),
              top: Math.min(packHover.y + 18, window.innerHeight - 280),
            }}
          >
            <img src={convertFileSrc(packHover.path)} alt="" />
            <span>{packHover.name}</span>
          </div>
        ) : null}

        </>
      )}

      <JobPanel job={job} onClose={() => setJob(null)} />
      {dragging && mode === 'pack' ? (
        <div className="sprite-page-drop">松开以加入合成列表</div>
      ) : null}
    </div>
  )
}

export default App
