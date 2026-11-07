import { useCallback, useEffect, useRef, useState } from "react";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { isTauriRuntime } from "../lib/platform";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "uptodate"
  | "error";

export interface AvailableUpdate {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return "检查更新失败，请稍后重试。";
}

export function useUpdater() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({
    downloaded: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const phaseRef = useRef<UpdatePhase>("idle");
  phaseRef.current = phase;

  const checkForUpdates = useCallback(async (manual = false) => {
    if (phaseRef.current === "checking" || phaseRef.current === "downloading") {
      if (manual) setOpen(true);
      return;
    }
    if (phaseRef.current === "available" && updateRef.current) {
      if (manual) setOpen(true);
      return;
    }
    if (!isTauriRuntime()) {
      if (manual) {
        setError("自动更新仅在桌面应用中可用。");
        setPhase("error");
        setOpen(true);
      }
      return;
    }

    if (manual) setOpen(true);
    setPhase("checking");
    setError(null);

    try {
      const found = await check({ timeout: 15000 });
      if (!found) {
        setPhase(manual ? "uptodate" : "idle");
        if (manual) setOpen(true);
        return;
      }

      updateRef.current = found;
      setUpdate({
        currentVersion: found.currentVersion,
        version: found.version,
        date: found.date,
        body: found.body,
      });
      setPhase("available");
      setOpen(true);
    } catch (reason) {
      setError(errorMessage(reason));
      setPhase(manual ? "error" : "idle");
      if (manual) setOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || import.meta.env.DEV) {
      return;
    }
    const timer = window.setTimeout(() => {
      void checkForUpdates(false);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  const install = useCallback(async () => {
    const current = updateRef.current;
    if (!current) return;

    setPhase("downloading");
    setError(null);
    setProgress({ downloaded: 0, total: 0 });

    try {
      await current.downloadAndInstall(
        (event: DownloadEvent) => {
          if (event.event === "Started") {
            setProgress({
              downloaded: 0,
              total: event.data.contentLength ?? 0,
            });
          } else if (event.event === "Progress") {
            setProgress((previous) => ({
              downloaded: previous.downloaded + event.data.chunkLength,
              total: previous.total,
            }));
          } else if (event.event === "Finished") {
            setProgress((previous) => ({
              downloaded:
                previous.total > 0 ? previous.total : previous.downloaded,
              total: previous.total,
            }));
          }
        },
        { restartAfterInstall: true },
      );
      setPhase("ready");
    } catch (reason) {
      setError(errorMessage(reason));
      setPhase("error");
      setOpen(true);
    }
  }, []);

  const closeDialog = useCallback(() => {
    if (phaseRef.current === "downloading") {
      return;
    }
    if (phaseRef.current === "available" && updateRef.current) {
      void updateRef.current.close().catch(() => undefined);
      updateRef.current = null;
      setUpdate(null);
      setPhase("idle");
    } else if (
      phaseRef.current === "error" ||
      phaseRef.current === "uptodate" ||
      phaseRef.current === "ready"
    ) {
      setPhase("idle");
      setError(null);
    }
    setOpen(false);
  }, []);

  return {
    open,
    phase,
    update,
    progress,
    error,
    checkForUpdates,
    install,
    closeDialog,
  };
}
