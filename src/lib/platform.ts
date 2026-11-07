import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  exists,
  readFile,
  remove,
  rename,
  writeFile,
} from "@tauri-apps/plugin-fs";

export interface ImportedPdf {
  path: string;
  name: string;
  parent: string;
  size: number;
  bytes: Uint8Array;
}

interface PreparedImport {
  parent: string;
  name: string;
  size: number;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function pickFileInBrowser(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);

    let settled = false;

    const finish = (file: File | null) => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener("focus", handleFocus);
      input.remove();
      resolve(file);
    };

    const handleFocus = () => {
      window.setTimeout(() => {
        if (!input.files || input.files.length === 0) {
          finish(null);
        }
      }, 500);
    };

    input.addEventListener(
      "change",
      () => {
        finish(input.files?.[0] ?? null);
      },
      { once: true },
    );
    input.addEventListener("cancel", () => finish(null), { once: true });
    window.addEventListener("focus", handleFocus, { once: true });
    input.click();
  });
}

async function prepareImportedPdf(path: string): Promise<ImportedPdf> {
  // The Rust command extends the runtime fs scope for files opened outside the
  // native dialog (drag & drop) and for the source directory used as the default
  // output location.
  const prepared = await invoke<PreparedImport>("prepare_import", { path });
  const bytes = await readFile(path);

  return {
    path,
    name: prepared.name,
    parent: prepared.parent,
    size: prepared.size,
    bytes,
  };
}

export async function pickPdf(
  dialogTitle = "选择 PDF 文件",
): Promise<ImportedPdf | null> {
  if (!isTauriRuntime()) {
    const file = await pickFileInBrowser();
    if (!file) {
      return null;
    }
    return {
      path: "",
      name: file.name,
      parent: "",
      size: file.size,
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  }

  const selected = await open({
    title: dialogTitle,
    multiple: false,
    directory: false,
    filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
  });

  if (!selected || Array.isArray(selected)) {
    return null;
  }

  return prepareImportedPdf(selected);
}

export async function readPdfFromPath(path: string): Promise<ImportedPdf> {
  return prepareImportedPdf(path);
}

export async function chooseOutputDirectory(
  defaultPath?: string,
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  const selected = await open({
    title: "选择输出文件夹",
    directory: true,
    multiple: false,
    recursive: false,
    defaultPath: defaultPath || undefined,
  });

  return typeof selected === "string" ? selected : null;
}

export async function outputFileExists(path: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }
  return exists(path);
}

export async function writeOutputFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeFile(path, bytes);
}

export async function renameOutputFile(
  from: string,
  to: string,
): Promise<void> {
  await rename(from, to);
}

export async function removeOutputFile(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await remove(path);
  } catch {
    // Best-effort cleanup: a missing temporary file is fine.
  }
}

export async function openFolder(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("open_folder", { path });
}

export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: "application/pdf",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
