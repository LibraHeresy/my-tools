import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export const PDFJS_ASSETS = {
  cMapUrl: "/pdfjs/cmaps/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
} as const;

export async function loadPdfDocument(
  data: Uint8Array,
): Promise<PDFDocumentProxy> {
  const loadingTask = getDocument({
    data: new Uint8Array(data),
    cMapPacked: true,
    cMapUrl: PDFJS_ASSETS.cMapUrl,
    standardFontDataUrl: PDFJS_ASSETS.standardFontDataUrl,
    wasmUrl: PDFJS_ASSETS.wasmUrl,
    iccUrl: PDFJS_ASSETS.iccUrl,
    useSystemFonts: true,
  });

  try {
    return await loadingTask.promise;
  } catch (error) {
    try {
      await loadingTask.destroy();
    } catch {
      // Preserve the original loading error.
    }
    throw error;
  }
}

function isErrorName(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === name
  );
}

export function isPasswordError(error: unknown): boolean {
  return (
    isErrorName(error, "PasswordException") ||
    (error instanceof Error &&
      error.message.toLowerCase().includes("password"))
  );
}

export function isInvalidPdfError(error: unknown): boolean {
  return (
    isErrorName(error, "InvalidPDFException") ||
    (error instanceof Error &&
      error.message.toLowerCase().includes("invalid pdf"))
  );
}

export function disposePdfDocument(pdf: PDFDocumentProxy | null): void {
  if (!pdf) {
    return;
  }
  void pdf.loadingTask.destroy().catch(() => undefined);
}
