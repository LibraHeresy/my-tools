import { invoke } from '@tauri-apps/api/core'
import type { ImageAnalysis, RemoveOptions } from './types'

export const analyzeImage = (path: string) =>
  invoke<ImageAnalysis>('analyze_image', { path })

export const listImages = (inputs: string[]) =>
  invoke<string[]>('list_images', { inputs })

export const previewImages = (
  requestId: string,
  inputs: string[],
  options: RemoveOptions,
) => invoke<void>('preview_images', { requestId, inputs, options })

export const previewImageFull = (path: string, options: RemoveOptions) =>
  invoke<string>('preview_image_full', { path, options })

export const convertImages = (
  inputs: string[],
  outDir: string,
  options: RemoveOptions,
) => invoke<void>('convert_images', { inputs, outDir, options })

export type {
  BatchPreviewDone,
  BatchPreviewProgress,
  ConvertReport,
  ConvertProgress,
} from './types'
