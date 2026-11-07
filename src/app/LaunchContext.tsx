import { createContext, useContext } from "react";

export interface PendingImport {
  path: string;
  id: number;
}

export interface ToolLaunchContextValue {
  pendingImport: PendingImport | null;
  clearPendingImport: () => void;
}

export const ToolLaunchContext = createContext<ToolLaunchContextValue | null>(
  null,
);

export function useToolLaunch(): ToolLaunchContextValue {
  const value = useContext(ToolLaunchContext);
  if (!value) {
    throw new Error("ToolLaunchContext is missing");
  }
  return value;
}
