import { useEffect, useRef } from "react";
import { useToolLaunch } from "../app/LaunchContext";

/**
 * Consumes a PDF path dropped onto the app / passed from another tool.
 * The first effect run wins, which also makes this safe under React StrictMode.
 */
export function usePendingPdfImport(handler: (path: string) => void): void {
  const { pendingImport, clearPendingImport } = useToolLaunch();
  const handledIdRef = useRef<number | null>(null);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!pendingImport || handledIdRef.current === pendingImport.id) {
      return;
    }

    handledIdRef.current = pendingImport.id;
    clearPendingImport();
    handlerRef.current(pendingImport.path);
  }, [clearPendingImport, pendingImport]);
}
