import { invoke } from '@tauri-apps/api/core'
import type {
  ImageAnalysis,
  PreviewResult,
  RemoveOptions,
} from './types'

export const analyzeImage = (path: string) =>
  invoke<ImageAnalysis>('analyze_image', { path })

export const previewImage = (path: string, options: RemoveOptions) =>
  invoke<PreviewResult>('preview_image', { path, options })

export const convertImages = (
  inputs: string[],
  outDir: string,
  options: RemoveOptions,
) => invoke<void>('convert_images', { inputs, outDir, options })

export type { ConvertReport, ConvertProgress } from './types'
