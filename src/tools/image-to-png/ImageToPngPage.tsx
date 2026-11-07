import { useEffect, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  Eye,
  FolderInput,
  ImagePlus,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useHashRoute } from '../../lib/router'
import { analyzeImage, convertImages, previewImage } from './api'
import type {
  BackgroundCandidate,
  ConvertProgress,
  ConvertReport,
  ImageAnalysis,
  PreviewResult,
  RemoveOptions,
} from './types'
import '../../styles/image-png.css'

type Color = { r: number; g: number; b: number }

const DEFAULT_COLOR: Color = { r: 255, g: 255, b: 255 }
const DEFAULT_OPTIONS = {
  tolerance: 24,
  feather: 12,
}

function pickImages(): Promise<string[] | null> {
  return openDialog({
    multiple: true,
    title: '选择要转换的图片（可多选）',
    filters: [
      {
        name: '图片',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'],
      },
    ],
  }).then((picked) => {
    if (!picked) return null
    return Array.isArray(picked) ? picked : [picked]
  })
}

function pickFolders(): Promise<string[] | null> {
  return openDialog({
    directory: true,
    multiple: true,
    title: '选择包含图片的文件夹（可多选）',
  }).then((picked) => {
    if (!picked) return null
    return Array.isArray(picked) ? picked : [picked]
  })
}

function pickDir(): Promise<string | null> {
  return openDialog({
    directory: true,
    title: '选择 PNG 输出目录',
  }).then((picked) => (typeof picked === 'string' ? picked : null))
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|webp|bmp|gif)$/i.test(path)
}

function parentDir(path: string): string {
  const parts = path.split(/[\\/]/)
  parts.pop()
  return parts.join('\\')
}

function hexOf(color: Color): string {
  const toHex = (value: number) => value.toString(16).padStart(2, '0')
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`
}

function parseHex(value: string): Color | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return null
  const int = Number.parseInt(match[1], 16)
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  }
}

function colorName(color: BackgroundCandidate | Color): string {
  const { r, g, b } = color
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (min > 242) return '白色'
  if (max < 18) return '黑色'
  if (max - min < 12) return '灰色'
  return hexOf(color)
}

function removeOptions(
  mode: 'uniform' | 'auto',
  color: Color,
  tolerance: number,
  feather: number,
): RemoveOptions {
  return {
    mode,
    color,
    tolerance,
    feather,
  }
}

function ImagePreview({
  src,
  alt,
  checker = true,
}: {
  src: string
  alt: string
  checker?: boolean
}) {
  return (
    <div className={`image-png-image-frame ${checker ? 'is-checker' : ''}`}>
      <img src={src} alt={alt} />
    </div>
  )
}

export default function ImageToPngPage() {
  const { navigate } = useHashRoute()
  const [inputs, setInputs] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [mode, setMode] = useState<'uniform' | 'auto'>('uniform')
  const [color, setColor] = useState<Color>(DEFAULT_COLOR)
  const [tolerance, setTolerance] = useState(DEFAULT_OPTIONS.tolerance)
  const [feather, setFeather] = useState(DEFAULT_OPTIONS.feather)
  const [outputDir, setOutputDir] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [job, setJob] = useState<{
    running: boolean
    done: number
    total: number
    label: string
  } | null>(null)
  const [report, setReport] = useState<ConvertReport | null>(null)
  const colorPicked = useRef(false)

  const addInputs = (paths: string[]) => {
    setInputs((current) => {
      const next = [...current]
      for (const path of paths) {
        if (!next.includes(path)) next.push(path)
      }
      return next
    })
    setError(null)
    const firstImage = paths.find(isImagePath)
    if (!selected && firstImage) setSelected(firstImage)
    if (!outputDir && firstImage) setOutputDir(parentDir(firstImage))
  }

  const handleAddImages = async () => {
    const picked = await pickImages()
    if (picked) addInputs(picked)
  }

  const handleAddFolders = async () => {
    const picked = await pickFolders()
    if (picked) addInputs(picked)
  }

  const handleClear = () => {
    setInputs([])
    setSelected(null)
    setAnalysis(null)
    setPreview(null)
    setReport(null)
    setError(null)
    setOutputDir('')
    colorPicked.current = false
    setColor(DEFAULT_COLOR)
  }

  const handleRemove = (path: string) => {
    setInputs((current) => current.filter((item) => item !== path))
    if (selected === path) {
      const next = inputs.find((item) => item !== path && isImagePath(item)) ?? null
      setSelected(next)
    }
  }

  const handleBack = () => {
    if (job?.running) return
    navigate('/')
  }

  useEffect(() => {
    if (!selected) {
      setAnalysis(null)
      setPreview(null)
      return
    }
    let cancelled = false
    void analyzeImage(selected)
      .then((result) => {
        if (cancelled) return
        setAnalysis(result)
        if (!colorPicked.current && result.candidates[0]) {
          const candidate = result.candidates[0]
          setColor({ r: candidate.r, g: candidate.g, b: candidate.b })
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setPreviewBusy(true)
      try {
        const result = await previewImage(
          selected,
          removeOptions(mode, color, tolerance, feather),
        )
        if (!cancelled) setPreview(result)
      } catch (reason) {
        if (!cancelled) setError(String(reason))
      } finally {
        if (!cancelled) setPreviewBusy(false)
      }
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [selected, mode, color.r, color.g, color.b, tolerance, feather])

  useEffect(() => {
    const unlisteners: Array<() => void> = []
    let cancelled = false

    void listen<ConvertProgress>('image-progress', (event) => {
      const payload = event.payload
      setJob({
        running: true,
        done: payload.index,
        total: payload.total,
        label: payload.name,
      })
    }).then((handle) => {
      if (cancelled) handle()
      else unlisteners.push(handle)
    })

    void listen<ConvertReport>('image-done', (event) => {
      setReport(event.payload)
      setJob({
        running: false,
        done: event.payload.total,
        total: event.payload.total,
        label: '',
      })
    }).then((handle) => {
      if (cancelled) handle()
      else unlisteners.push(handle)
    })

    return () => {
      cancelled = true
      unlisteners.forEach((un) => un())
    }
  }, [])

  useEffect(() => {
    const unlistenPromise = import('@tauri-apps/api/webview').then(
      ({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (event.payload.type === 'over') setDragging(true)
          else if (event.payload.type === 'drop') {
            setDragging(false)
            if (event.payload.paths.length > 0) addInputs(event.payload.paths)
          } else setDragging(false)
        }),
    )
    return () => {
      void unlistenPromise.then((unlisten) => unlisten())
    }
  }, [])

  const setColorAndMark = (next: Color) => {
    colorPicked.current = true
    setColor(next)
  }

  const handleChooseCandidate = (candidate: BackgroundCandidate) => {
    setColorAndMark({ r: candidate.r, g: candidate.g, b: candidate.b })
  }

  const handleHexChange = (value: string) => {
    const next = parseHex(value)
    if (next) setColorAndMark(next)
  }

  const handleStart = async () => {
    if (inputs.length === 0) {
      setError('请先添加要转换的图片或文件夹。')
      return
    }
    let dir = outputDir
    if (!dir) {
      dir = (await pickDir()) ?? ''
      if (!dir) return
      setOutputDir(dir)
    }
    setError(null)
    setReport(null)
    setJob({ running: true, done: 0, total: inputs.length, label: '' })
    try {
      await convertImages(inputs, dir, removeOptions(mode, color, tolerance, feather))
    } catch (reason) {
      setError(String(reason))
      setJob(null)
    }
  }

  const handleOpenOutput = () => {
    if (outputDir) void invoke('open_folder', { path: outputDir })
  }

  const selectedPreview = showOriginal
    ? selected && isImagePath(selected)
      ? convertFileSrc(selected)
      : null
    : preview
      ? convertFileSrc(preview.path)
      : null

  return (
    <div className="tool-page image-png-page">
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
        <span className="breadcrumb-current">图片转 PNG</span>
        <span className="topbar-spacer" />
        <span className="local-chip">
          <ShieldCheck size={14} />
          本地处理
        </span>
      </div>

      <header className="tool-heading">
        <div>
          <span className="eyebrow">素材</span>
          <h1>图片转 PNG</h1>
          <p>批量把纯色背景转为透明通道，输出可直接使用的 PNG。</p>
        </div>
        <span className="loaded-chip">
          <span className="loaded-dot" />
          {inputs.length} 个文件
        </span>
      </header>

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

      <div className="image-png-layout">
        <div className="image-png-left">
          <section className="image-png-preview-panel">
            <header className="image-png-preview-head">
              <div>
                <span className="panel-kicker">预览</span>
                <h2>{selected ? fileName(selected) : '等待选择图片'}</h2>
              </div>
              <div className="image-png-preview-actions">
                <button
                  type="button"
                  className={`text-button ${showOriginal ? 'is-active' : ''}`}
                  onClick={() => setShowOriginal(true)}
                  disabled={!selected}
                >
                  <Eye size={13} />
                  原图
                </button>
                <button
                  type="button"
                  className={`text-button ${!showOriginal ? 'is-active' : ''}`}
                  onClick={() => setShowOriginal(false)}
                  disabled={!selected}
                >
                  处理结果
                </button>
              </div>
            </header>

            <div className="image-png-stage">
              {selectedPreview ? (
                <ImagePreview src={selectedPreview} alt="图片预览" />
              ) : (
                <div className="image-png-stage-empty">
                  <ImagePlus size={25} />
                  <p>添加图片后在这里查看透明背景预览</p>
                </div>
              )}
              {previewBusy ? (
                <span className="image-png-preview-busy">
                  <LoaderCircle size={14} className="spin" />
                  更新预览
                </span>
              ) : null}
            </div>

            <footer className="image-png-preview-foot">
              <span>
                {analysis
                  ? `原图 ${analysis.width} × ${analysis.height}`
                  : '支持 PNG / JPG / WebP / BMP'}
              </span>
              <span>
                {preview && !showOriginal
                  ? `预览 ${preview.width} × ${preview.height}`
                  : '棋盘格表示透明区域'}
              </span>
            </footer>
          </section>

          <section className="image-png-input-panel">
            <header className="image-png-input-head">
              <div>
                <span className="panel-kicker">批量</span>
                <h2>待转换图片</h2>
              </div>
              <div className="image-png-input-actions">
                <button type="button" className="text-button" onClick={handleAddImages}>
                  添加图片
                </button>
                <button type="button" className="text-button" onClick={handleAddFolders}>
                  添加文件夹
                </button>
                {inputs.length > 0 ? (
                  <button type="button" className="text-button" onClick={handleClear}>
                    <Trash2 size={12} />
                    清空
                  </button>
                ) : null}
              </div>
            </header>

            {inputs.length === 0 ? (
              <div className="image-png-input-empty">
                <button type="button" className="btn btn-primary" onClick={handleAddImages}>
                  <ImagePlus size={17} />
                  选择图片
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleAddFolders}>
                  <FolderInput size={17} />
                  选择文件夹
                </button>
                <p>也可以直接拖入图片或文件夹</p>
              </div>
            ) : (
              <div className="image-png-input-grid">
                {inputs.map((path) => {
                  const image = isImagePath(path)
                  const active = selected === path
                  return (
                    <div
                      className={`image-png-input-card ${active ? 'is-active' : ''}`}
                      key={path}
                    >
                      <button
                        type="button"
                        className="image-png-input-select"
                        onClick={() => {
                          if (image) setSelected(path)
                        }}
                        disabled={!image}
                        title={image ? '点击预览' : '文件夹会在转换时递归处理'}
                      >
                        <span className="image-png-input-thumb">
                          {image ? (
                            <img src={convertFileSrc(path)} alt="" />
                          ) : (
                            <FolderInput size={20} />
                          )}
                        </span>
                        <span className="image-png-input-name">{fileName(path)}</span>
                      </button>
                      <button
                        type="button"
                        className="image-png-input-remove"
                        aria-label={`移除 ${fileName(path)}`}
                        onClick={() => handleRemove(path)}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="image-png-settings">
          <section className="image-png-settings-card">
            <header className="image-png-settings-head">
              <div>
                <span className="panel-kicker">背景</span>
                <h2>背景颜色</h2>
              </div>
              {preview ? (
                <span className="count-chip">{preview.background.hex}</span>
              ) : null}
            </header>

            <div className="image-png-mode-switch">
              <button
                type="button"
                className={mode === 'uniform' ? 'is-active' : ''}
                onClick={() => setMode('uniform')}
              >
                统一颜色
              </button>
              <button
                type="button"
                className={mode === 'auto' ? 'is-active' : ''}
                onClick={() => setMode('auto')}
              >
                每张自动
              </button>
            </div>

            {mode === 'uniform' ? (
              <>
                <p className="field-label image-png-candidate-title">
                  从图片边缘识别到的颜色
                </p>
                {analysis && analysis.candidates.length > 0 ? (
                  <div className="image-png-candidates">
                    {analysis.candidates.map((candidate) => {
                      const active =
                        candidate.r === color.r &&
                        candidate.g === color.g &&
                        candidate.b === color.b
                      return (
                        <button
                          type="button"
                          key={`${candidate.hex}-${candidate.coverage}`}
                          className={`image-png-candidate ${active ? 'is-active' : ''}`}
                          onClick={() => handleChooseCandidate(candidate)}
                          title={`${candidate.hex} · ${candidate.coverage}%`}
                        >
                          <span
                            className="image-png-swatch"
                            style={{ background: candidate.hex }}
                          />
                          <span>
                            <strong>{colorName(candidate)}</strong>
                            <small>
                              {candidate.hex} · {candidate.coverage}%
                            </small>
                          </span>
                          {active ? <Check size={13} /> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="field-hint">添加图片后会自动提取边缘候选色。</p>
                )}

                <label className="image-png-color-custom">
                  <span>自定义颜色</span>
                  <span className="image-png-color-input">
                    <input
                      type="color"
                      value={hexOf(color)}
                      onChange={(event) => handleHexChange(event.target.value)}
                      aria-label="选择背景颜色"
                    />
                    <input
                      className="text-input"
                      type="text"
                      value={hexOf(color)}
                      onChange={(event) => handleHexChange(event.target.value)}
                      aria-label="背景颜色十六进制"
                    />
                  </span>
                </label>
              </>
            ) : (
              <p className="field-hint">
                每张图片会单独识别边缘主色作为背景色。复杂图片仍可能残留边缘。
              </p>
            )}

            <div className="image-png-field">
              <div className="image-png-field-head">
                <label htmlFor="image-png-tolerance">容差</label>
                <span>{tolerance}</span>
              </div>
              <input
                id="image-png-tolerance"
                type="range"
                min={0}
                max={128}
                step={1}
                value={tolerance}
                onChange={(event) => setTolerance(Number(event.target.value))}
              />
              <p className="field-hint">颜色差值小于容差的像素会变透明。</p>
            </div>

            <div className="image-png-field">
              <div className="image-png-field-head">
                <label htmlFor="image-png-feather">边缘羽化</label>
                <span>{feather}</span>
              </div>
              <input
                id="image-png-feather"
                type="range"
                min={0}
                max={64}
                step={1}
                value={feather}
                onChange={(event) => setFeather(Number(event.target.value))}
              />
              <p className="field-hint">数值越大，边缘过渡越柔和。</p>
            </div>
          </section>

          <section className="image-png-settings-card">
            <header className="image-png-settings-head">
              <div>
                <span className="panel-kicker">输出</span>
                <h2>导出 PNG</h2>
              </div>
              <span className="count-chip">{inputs.length} 个</span>
            </header>

            <button
              type="button"
              className="image-png-output-path"
              onClick={async () => {
                const dir = await pickDir()
                if (dir) setOutputDir(dir)
              }}
              title={outputDir}
            >
              <FolderInput size={14} />
              <span>{outputDir || '选择输出目录'}</span>
            </button>

            <button
              type="button"
              className="btn btn-primary btn-block image-png-start"
              onClick={() => void handleStart()}
              disabled={inputs.length === 0 || Boolean(job?.running)}
            >
              <Download size={17} />
              {job?.running ? '正在转换…' : '开始转换'}
            </button>
            <p className="field-hint">
              输出同名 PNG；重名会自动编号，不覆盖原文件。
            </p>
          </section>
        </aside>
      </div>

      {job ? (
        <section className="image-png-job" role="status">
          <header>
            <div>
              <span className="panel-kicker">任务</span>
              <strong>{job.running ? '正在转换' : '转换完成'}</strong>
            </div>
            {!job.running ? (
              <button
                type="button"
                className="icon-button"
                aria-label="关闭任务面板"
                onClick={() => {
                  setJob(null)
                  setReport(null)
                }}
              >
                <X size={14} />
              </button>
            ) : null}
          </header>
          {job.running ? (
            <>
              <div className="image-png-progress">
                <span
                  style={{
                    width: `${job.total > 0 ? (job.done / job.total) * 100 : 0}%`,
                  }}
                />
              </div>
              <p>
                {job.done} / {job.total} · {job.label || '准备中'}
              </p>
            </>
          ) : report ? (
            <>
              <p>
                成功 {report.succeeded} 个，失败 {report.failed} 个，用时{' '}
                {(report.elapsedMs / 1000).toFixed(2)} 秒
              </p>
              {report.files.filter((file) => file.error).length > 0 ? (
                <ul className="image-png-job-errors">
                  {report.files
                    .filter((file) => file.error)
                    .slice(0, 4)
                    .map((file) => (
                      <li key={file.path}>
                        {file.name}：{file.error}
                      </li>
                    ))}
                </ul>
              ) : null}
              <button
                type="button"
                className="text-button"
                onClick={handleOpenOutput}
              >
                打开输出目录
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {dragging ? (
        <div className="image-png-drop">松开以添加图片或文件夹</div>
      ) : null}
    </div>
  )
}

