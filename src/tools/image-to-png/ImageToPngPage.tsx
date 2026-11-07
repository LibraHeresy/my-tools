import { useEffect, useRef, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  FolderInput,
  ImagePlus,
  LoaderCircle,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useHashRoute } from '../../lib/router'
import { ImageLightbox, type ImageLightboxItem } from '../../components/ImageLightbox'
import { analyzeImage, convertImages, listImages, previewImageFull, previewImages } from './api'
import type {
  BackgroundCandidate,
  BatchPreviewDone,
  BatchPreviewItem,
  BatchPreviewProgress,
  ConvertProgress,
  ConvertReport,
  ImageAnalysis,
  RemoveOptions,
} from './types'
import '../../styles/image-png.css'

type Color = { r: number; g: number; b: number }

const DEFAULT_COLOR: Color = { r: 255, g: 255, b: 255 }
const DEFAULT_TOLERANCE = 24
const DEFAULT_FEATHER = 12

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
  return { mode, color, tolerance, feather }
}

export default function ImageToPngPage() {
  const { navigate } = useHashRoute()
  const [inputs, setInputs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<'input' | 'result'>('input')
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null)
  const [previews, setPreviews] = useState<Record<string, BatchPreviewItem>>({})
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewTotal, setPreviewTotal] = useState(0)
  const [mode, setMode] = useState<'uniform' | 'auto'>('uniform')
  const [color, setColor] = useState<Color>(DEFAULT_COLOR)
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE)
  const [feather, setFeather] = useState(DEFAULT_FEATHER)
  const [outputDir, setOutputDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState<{
    src: string
    name: string
    x: number
    y: number
  } | null>(null)
  const [lightbox, setLightbox] = useState<{
    kind: 'input' | 'result'
    index: number
  } | null>(null)
  const [fullPreviews, setFullPreviews] = useState<Record<string, string>>({})
  const fullPreviewEpoch = useRef(0)
  const fullPreviewLoading = useRef<Set<string>>(new Set())
  const [job, setJob] = useState<{
    running: boolean
    done: number
    total: number
    label: string
  } | null>(null)
  const [report, setReport] = useState<ConvertReport | null>(null)
  const colorPicked = useRef(false)
  const requestRef = useRef(0)

  const addInputs = async (paths: string[]) => {
    try {
      const images = await listImages(paths)
      if (images.length === 0) {
        setError('所选文件夹里没有可用图片。')
        return
      }
      setInputs((current) => {
        const next = [...current]
        for (const path of images) {
          if (!next.includes(path)) next.push(path)
        }
        return next
      })
      setActiveTab('input')
      setError(null)
      if (!outputDir && images[0]) setOutputDir(parentDir(images[0]))
    } catch (reason) {
      setError(String(reason))
    }
  }

  const handleAddImages = async () => {
    const picked = await pickImages()
    if (picked) void addInputs(picked)
  }

  const handleAddFolders = async () => {
    const picked = await pickFolders()
    if (picked) void addInputs(picked)
  }

  const handleClear = () => {
    requestRef.current += 1
    setInputs([])
    setAnalysis(null)
    setPreviews({})
    setPreviewBusy(false)
    setPreviewTotal(0)
    setReport(null)
    setError(null)
    setOutputDir('')
    colorPicked.current = false
    setColor(DEFAULT_COLOR)
    setActiveTab('input')
  }

  const handleRemove = (path: string) => {
    setInputs((current) => current.filter((item) => item !== path))
    setPreviews((current) => {
      const next = { ...current }
      delete next[path]
      return next
    })
  }

  const handleBack = () => {
    if (job?.running) return
    navigate('/')
  }

  useEffect(() => {
    const first = inputs[0]
    if (!first) {
      setAnalysis(null)
      return
    }
    let cancelled = false
    void analyzeImage(first)
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
  }, [inputs[0]])

  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []

    void listen<BatchPreviewProgress>('image-preview', (event) => {
      const payload = event.payload
      if (payload.requestId !== String(requestRef.current)) return
      setPreviewTotal(payload.total)
      setPreviews((current) => ({
        ...current,
        [payload.item.sourcePath]: payload.item,
      }))
    }).then((un) => {
      if (disposed) un()
      else unlisteners.push(un)
    })

    void listen<BatchPreviewDone>('image-preview-done', (event) => {
      if (event.payload.requestId !== String(requestRef.current)) return
      setPreviewTotal(event.payload.total)
      setPreviewBusy(false)
    }).then((un) => {
      if (disposed) un()
      else unlisteners.push(un)
    })

    return () => {
      disposed = true
      unlisteners.forEach((un) => un())
    }
  }, [])

  useEffect(() => {
    if (inputs.length === 0) {
      setPreviews({})
      setPreviewBusy(false)
      setPreviewTotal(0)
      return
    }

    const timer = window.setTimeout(() => {
      const requestId = String(++requestRef.current)
      setPreviews({})
      setPreviewTotal(inputs.length)
      setPreviewBusy(true)
      void previewImages(
        requestId,
        inputs,
        removeOptions(mode, color, tolerance, feather),
      ).catch((reason) => {
        if (String(requestRef.current) !== requestId) return
        setPreviewBusy(false)
        setError(String(reason))
      })
    }, 320)

    return () => window.clearTimeout(timer)
  }, [inputs, mode, color.r, color.g, color.b, tolerance, feather])

  useEffect(() => {
    fullPreviewEpoch.current += 1
    fullPreviewLoading.current.clear()
    setFullPreviews({})
  }, [inputs, mode, color.r, color.g, color.b, tolerance, feather])

  useEffect(() => {
    const unlisteners: Array<() => void> = []
    let disposed = false

    void listen<ConvertProgress>('image-progress', (event) => {
      const payload = event.payload
      setJob({
        running: true,
        done: payload.index,
        total: payload.total,
        label: payload.name,
      })
    }).then((un) => {
      if (disposed) un()
      else unlisteners.push(un)
    })

    void listen<ConvertReport>('image-done', (event) => {
      const payload = event.payload
      setReport(payload)
      setJob({
        running: false,
        done: payload.total,
        total: payload.total,
        label: '',
      })
    }).then((un) => {
      if (disposed) un()
      else unlisteners.push(un)
    })

    return () => {
      disposed = true
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
            if (event.payload.paths.length > 0) {
              void addInputs(event.payload.paths)
            }
          } else setDragging(false)
        }),
    )
    return () => {
      void unlistenPromise.then((un) => un())
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

  const showHover = (
    event: React.MouseEvent,
    src: string,
    name: string,
  ) => {
    setHover({ src, name, x: event.clientX, y: event.clientY })
  }

  const moveHover = (event: React.MouseEvent) => {
    setHover((current) =>
      current ? { ...current, x: event.clientX, y: event.clientY } : current,
    )
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
      await convertImages(
        inputs,
        dir,
        removeOptions(mode, color, tolerance, feather),
      )
    } catch (reason) {
      setError(String(reason))
      setJob(null)
    }
  }

  const handleOpenOutput = () => {
    if (outputDir) void invoke('open_folder', { path: outputDir })
  }

  const previewCount = Object.keys(previews).length
  const inputLightboxItems: ImageLightboxItem[] = inputs.map((path) => ({
    src: convertFileSrc(path),
    name: fileName(path),
    checker: true,
  }))
  const resultLightboxPaths = inputs.filter(
    (path) => previews[path]?.previewPath,
  )
  const resultLightboxItems: ImageLightboxItem[] = resultLightboxPaths.map(
    (path) => {
      const item = previews[path]
      return {
        src: convertFileSrc(fullPreviews[path] ?? (item.previewPath as string)),
        name: fileName(path),
        meta: item.background?.hex,
        checker: true,
      }
    },
  )
  const loadFullPreview = (path: string) => {
    if (fullPreviews[path] || fullPreviewLoading.current.has(path)) return
    fullPreviewLoading.current.add(path)
    const epoch = fullPreviewEpoch.current
    void previewImageFull(
      path,
      removeOptions(mode, color, tolerance, feather),
    )
      .then((fullPath) => {
        if (epoch !== fullPreviewEpoch.current) return
        setFullPreviews((current) => ({ ...current, [path]: fullPath }))
      })
      .catch(() => {
        // 保留已有的列表缩略图作为回退
      })
      .finally(() => {
        fullPreviewLoading.current.delete(path)
      })
  }
  const openInputLightbox = (path: string) => {
    setHover(null)
    setLightbox({ kind: 'input', index: Math.max(0, inputs.indexOf(path)) })
  }
  const openResultLightbox = (path: string) => {
    const index = resultLightboxPaths.indexOf(path)
    if (index < 0) return
    setHover(null)
    setLightbox({ kind: 'result', index })
    loadFullPreview(path)
  }
  const hoverLeft = hover
    ? Math.min(hover.x + 16, Math.max(16, window.innerWidth - 330))
    : 0
  const hoverTop = hover
    ? Math.min(hover.y + 18, Math.max(16, window.innerHeight - 300))
    : 0

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
          <section className="image-png-panel">
            <header className="image-png-panel-head">
              <div>
                <span className="panel-kicker">
                  {activeTab === 'input' ? '输入' : '预览'}
                </span>
                <h2>{activeTab === 'input' ? '已选图片' : '处理结果'}</h2>
              </div>
              <div className="image-png-panel-actions">
                <button type="button" className="text-button" onClick={() => void handleAddImages()}>
                  添加图片
                </button>
                <button type="button" className="text-button" onClick={() => void handleAddFolders()}>
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

            <div className="image-png-tabs" role="tablist" aria-label="图片列表">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'input'}
                className={activeTab === 'input' ? 'is-active' : ''}
                onClick={() => setActiveTab('input')}
              >
                已选图片 <span>{inputs.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'result'}
                className={activeTab === 'result' ? 'is-active' : ''}
                onClick={() => setActiveTab('result')}
              >
                处理结果{' '}
                <span>
                  {previewBusy
                    ? `${previewCount}/${previewTotal}`
                    : previewCount}
                </span>
              </button>
            </div>

            {activeTab === 'input' ? (
              inputs.length === 0 ? (
                <div className="image-png-empty">
                  <span className="image-png-empty-icon">
                    <ImagePlus size={24} />
                  </span>
                  <h3>选择要转换的图片</h3>
                  <p>可以选多张图片，也可以选文件夹递归展开其中的图片。</p>
                  <div className="image-png-empty-actions">
                    <button type="button" className="btn btn-primary" onClick={() => void handleAddImages()}>
                      <ImagePlus size={17} />
                      选择图片
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => void handleAddFolders()}>
                      <FolderInput size={17} />
                      选择文件夹
                    </button>
                  </div>
                  <span className="image-png-hint">支持 PNG / JPG / WebP / BMP / GIF</span>
                </div>
              ) : (
                <div className="image-png-grid">
                  {inputs.map((path) => (
                    <div
                      className="image-png-card"
                      key={path}
                      onMouseEnter={(event) =>
                        showHover(event, convertFileSrc(path), fileName(path))
                      }
                      onMouseMove={moveHover}
                      onMouseLeave={() => setHover(null)}
                    >
                      <span
                        className="image-png-media"
                        role="button"
                        tabIndex={0}
                        title={`查看 ${fileName(path)} 大图`}
                        onClick={() => openInputLightbox(path)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            openInputLightbox(path)
                          }
                        }}
                      >
                        <img src={convertFileSrc(path)} alt="" />
                      </span>
                      <span className="image-png-name" title={path}>
                        {fileName(path)}
                      </span>
                      <button
                        type="button"
                        className="image-png-remove"
                        aria-label={`移除 ${fileName(path)}`}
                        onClick={() => handleRemove(path)}
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )
            ) : inputs.length === 0 ? (
              <div className="image-png-result-empty">
                <span className="image-png-empty-icon">
                  <ImagePlus size={22} />
                </span>
                <p>添加图片后，这里会显示按当前参数处理的透明 PNG 缩略图。</p>
              </div>
            ) : (
              <div className="image-png-grid is-result">
                {inputs.map((path) => {
                  const item = previews[path]
                  return (
                    <div className="image-png-card is-result" key={path}>
                      <span
                        className="image-png-media is-checker"
                        role={item?.previewPath ? 'button' : undefined}
                        tabIndex={item?.previewPath ? 0 : undefined}
                        title={item?.previewPath ? `查看 ${fileName(path)} 大图` : undefined}
                        onMouseEnter={(event) => {
                          if (item?.previewPath) {
                            showHover(
                              event,
                              convertFileSrc(item.previewPath),
                              fileName(path),
                            )
                          }
                        }}
                        onMouseMove={moveHover}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => {
                          if (item?.previewPath) openResultLightbox(path)
                        }}
                        onKeyDown={(event) => {
                          if (
                            item?.previewPath &&
                            (event.key === 'Enter' || event.key === ' ')
                          ) {
                            event.preventDefault()
                            openResultLightbox(path)
                          }
                        }}
                      >
                        {item?.previewPath ? (
                          <img src={convertFileSrc(item.previewPath)} alt="" />
                        ) : item?.error ? (
                          <span className="image-png-preview-error" title={item.error}>
                            <AlertTriangle size={18} />
                          </span>
                        ) : (
                          <span className="image-png-preview-loading">
                            <LoaderCircle size={16} className="spin" />
                          </span>
                        )}
                      </span>
                      <span className="image-png-name" title={path}>
                        {fileName(path)}
                      </span>
                      {item?.background ? (
                        <span className="image-png-bg">{item.background.hex}</span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="image-png-settings">
          <section className="image-png-settings-card is-background">
            <header className="image-png-settings-head">
              <div>
                <span className="panel-kicker">背景</span>
                <h2>背景颜色</h2>
              </div>
              {analysis ? <span className="count-chip">首张图</span> : null}
            </header>

            <div className="image-png-settings-body">
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
                  <p className="field-hint">添加图片后会自动提取首张图片的边缘候选色。</p>
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
            </div>
          </section>

          <section className="image-png-settings-card is-output">
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
            <p className="field-hint">输出同名 PNG；重名会自动编号，不覆盖原文件。</p>
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
              <button type="button" className="text-button" onClick={handleOpenOutput}>
                打开输出目录
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {lightbox ? (
        <ImageLightbox
          items={
            lightbox.kind === 'input' ? inputLightboxItems : resultLightboxItems
          }
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onIndexChange={(index) => {
            if (lightbox.kind !== 'result') return
            const path = resultLightboxPaths[index]
            if (path) loadFullPreview(path)
          }}
        />
      ) : null}

      {hover ? (
        <div
          className="image-png-hover"
          style={{ left: hoverLeft, top: hoverTop }}
        >
          <img src={hover.src} alt="" />
          <span>{hover.name}</span>
        </div>
      ) : null}

      {dragging ? (
        <div className="image-png-drop">松开以添加图片或文件夹</div>
      ) : null}
    </div>
  )
}
