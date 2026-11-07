import Konva from 'konva'
import { useEffect, useRef } from 'react'
import type { SpriteRect } from '../types'

interface Props {
  imageUrl: string | null
  sheetW: number
  sheetH: number
  sprites: SpriteRect[]
  selectedIds: number[]
  onToggleSelect: (id: number) => void
  onClearSelection: () => void
  showLabels: boolean
}

/** 缩放时保持线宽与字号恒定——否则放大 8 倍后框线会变成一条粗黑带。 */
function compensateScale(stage: Konva.Stage, group: Konva.Group) {
  const s = stage.scaleX() || 1
  for (const node of group.getChildren()) {
    const cls = node.getClassName()
    if (cls === 'Rect') (node as Konva.Rect).strokeWidth(1.5 / s)
    else if (cls === 'Text') (node as Konva.Text).fontSize(12 / s)
  }
}

export function SpriteCanvas({
  imageUrl,
  sheetW,
  sheetH,
  sprites,
  selectedIds,
  onToggleSelect,
  onClearSelection,
  showLabels,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const bgRef = useRef<Konva.Layer | null>(null)
  const fgGroupRef = useRef<Konva.Group | null>(null)
  const fitRef = useRef<() => void>(() => {})

  const onToggleRef = useRef(onToggleSelect)
  onToggleRef.current = onToggleSelect
  const onClearRef = useRef(onClearSelection)
  onClearRef.current = onClearSelection
  const sizeRef = useRef({ w: sheetW, h: sheetH })
  sizeRef.current = { w: sheetW, h: sheetH }

  // 建立 Stage / Layer（整个生命周期只做一次）
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const stage = new Konva.Stage({
      container: host,
      width: host.clientWidth,
      height: host.clientHeight,
      draggable: true,
    })
    const bg = new Konva.Layer()
    const fg = new Konva.Layer()
    const fgGroup = new Konva.Group()
    fg.add(fgGroup)
    stage.add(bg)
    stage.add(fg)

    stageRef.current = stage
    bgRef.current = bg
    fgGroupRef.current = fgGroup

    fitRef.current = () => {
      const { w, h } = sizeRef.current
      if (!w || !h) return
      const pad = 28
      const scale = Math.min(
        (stage.width() - pad * 2) / w,
        (stage.height() - pad * 2) / h,
        1,
      )
      const s = Math.max(scale, 0.02)
      stage.scale({ x: s, y: s })
      stage.position({
        x: (stage.width() - w * s) / 2,
        y: (stage.height() - h * s) / 2,
      })
      compensateScale(stage, fgGroup)
      stage.batchDraw()
    }

    // 滚轮缩放（以指针为锚点）
    stage.on('wheel', (e) => {
      e.evt.preventDefault()
      const pointer = stage.getPointerPosition()
      if (!pointer) return
      const oldScale = stage.scaleX() || 1
      const factor = e.evt.deltaY < 0 ? 1.12 : 1 / 1.12
      const newScale = Math.min(8, Math.max(0.05, oldScale * factor))
      const anchor = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      }
      stage.scale({ x: newScale, y: newScale })
      stage.position({
        x: pointer.x - anchor.x * newScale,
        y: pointer.y - anchor.y * newScale,
      })
      compensateScale(stage, fgGroup)
      stage.batchDraw()
    })

    // 点空白处取消选中
    stage.on('click tap', (e) => {
      if (e.target === stage) onClearRef.current()
    })

    const ro = new ResizeObserver(() => {
      stage.width(host.clientWidth)
      stage.height(host.clientHeight)
      stage.batchDraw()
    })
    ro.observe(host)

    return () => {
      ro.disconnect()
      stage.destroy()
      stageRef.current = null
      bgRef.current = null
      fgGroupRef.current = null
    }
  }, [])

  // 载入图片
  useEffect(() => {
    const stage = stageRef.current
    const bg = bgRef.current
    if (!stage || !bg) return

    bg.destroyChildren()
    if (!imageUrl) {
      stage.batchDraw()
      return
    }

    let cancelled = false
    const img = new window.Image()
    img.onload = () => {
      if (cancelled || !stageRef.current || !bgRef.current) return
      bgRef.current.add(new Konva.Image({ image: img, x: 0, y: 0, listening: false }))
      fitRef.current()
    }
    img.onerror = () => {
      if (!cancelled) console.error('图片载入失败', imageUrl)
    }
    img.src = imageUrl

    return () => {
      cancelled = true
    }
  }, [imageUrl, sheetW, sheetH])

  // 重建矩形叠加层
  useEffect(() => {
    const stage = stageRef.current
    const group = fgGroupRef.current
    if (!stage || !group) return

    group.destroyChildren()
    const scale = stage.scaleX() || 1

    for (const s of sprites) {
      const selected = selectedIds.includes(s.id)
      const stroke = s.excluded ? '#a39a8c' : selected ? '#b86a1e' : '#d84a2f'
      const fill = s.excluded
        ? 'rgba(163,154,140,0.12)'
        : selected
          ? 'rgba(184,106,30,0.16)'
          : 'rgba(216,74,47,0.06)'

      const rect = new Konva.Rect({
        x: s.x,
        y: s.y,
        width: s.w,
        height: s.h,
        stroke,
        strokeWidth: 1.5 / scale,
        fill,
        ...(s.excluded ? { dash: [6 / scale, 4 / scale] } : {}),
      })
      rect.on('click tap', (e) => {
        e.cancelBubble = true
        onToggleRef.current(s.id)
      })
      rect.on('mouseenter', () => {
        const c = stageRef.current?.container()
        if (c) c.style.cursor = 'pointer'
      })
      rect.on('mouseleave', () => {
        const c = stageRef.current?.container()
        if (c) c.style.cursor = 'default'
      })
      group.add(rect)

      if (showLabels) {
        group.add(
          new Konva.Text({
            x: s.x,
            y: Math.max(0, s.y - 13 / scale),
            text: `#${s.id} ${s.w}×${s.h}`,
            fontSize: 12 / scale,
            fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif',
            fill: '#8f3d25',
            listening: false,
          }),
        )
      }
    }

    stage.batchDraw()
  }, [sprites, selectedIds, showLabels])

  return <div className="canvas-host" ref={hostRef} />
}
