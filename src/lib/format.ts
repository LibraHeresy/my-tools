export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  const digits = index === 0 || value >= 10 ? 0 : 1;

  return `${value.toFixed(digits)} ${units[index]}`;
}

export function truncateMiddle(value: string, maxLength = 52): string {
  if (value.length <= maxLength) {
    return value;
  }

  const start = Math.ceil((maxLength - 1) * 0.55);
  const end = Math.max(0, maxLength - 1 - start);
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function joinPath(directory: string, fileName: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${fileName}`;
}

export function directoryName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(
    normalized.lastIndexOf("\\"),
    normalized.lastIndexOf("/"),
  );
  return index > 0 ? normalized.slice(0, index) : normalized;
}

export function fileName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(
    normalized.lastIndexOf("\\"),
    normalized.lastIndexOf("/"),
  );
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
