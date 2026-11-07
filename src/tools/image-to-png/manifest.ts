import { ImageDown } from 'lucide-react'
import type { ToolManifest } from '../types'

export const imageToPngTool: ToolManifest = {
  id: 'image-to-png',
  title: '图片转 PNG',
  description: '批量去除纯色背景，输出透明 PNG。',
  category: 'assets',
  icon: ImageDown,
  route: '/tools/image-to-png',
  keywords: ['图片', 'png', '透明', '背景', '抠图', '批量'],
  status: 'available',
  order: 85,
}
