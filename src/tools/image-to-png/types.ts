export interface BackgroundColor {
  r: number
  g: number
  b: number
  hex: string
}

export interface BackgroundCandidate extends BackgroundColor {
  coverage: number
}

export interface ImageAnalysis {
  path: string
  fileName: string
  width: number
  height: number
  candidates: BackgroundCandidate[]
}

export interface RemoveOptions {
  mode: 'uniform' | 'auto'
  color: { r: number; g: number; b: number }
  tolerance: number
  feather: number
}

export interface PreviewResult {
  path: string
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  background: BackgroundColor
}

export interface ConvertFileReport {
  name: string
  path: string
  outPath: string
  width: number
  height: number
  background: BackgroundColor
  elapsedMs: number
  error: string | null
}

export interface ConvertProgress {
  index: number
  total: number
  name: string
  error: string | null
}

export interface ConvertReport {
  total: number
  succeeded: number
  failed: number
  elapsedMs: number
  files: ConvertFileReport[]
}
