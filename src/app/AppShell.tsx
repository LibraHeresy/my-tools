import type { ReactNode } from "react";
import { Info, LayoutGrid, LockKeyhole, ShieldCheck } from "lucide-react";
import type { ToolManifest } from "../tools/types";

interface AppShellProps {
  children: ReactNode;
  isHome: boolean;
  currentTool?: ToolManifest;
  tools: ToolManifest[];
  onToolSelect: (route: string) => void;
  onHome: () => void;
  onAbout: () => void;
}

export function AppShell({
  children,
  isHome,
  currentTool,
  tools,
  onToolSelect,
  onHome,
  onAbout,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button type="button" className="brand" onClick={onHome}>
          <img src="/app-icon.png" alt="" className="brand-icon" />
          <span className="brand-copy">
            <strong>PDF 工具台</strong>
            <small>本地工作台</small>
          </span>
        </button>

        <nav className="sidebar-nav" aria-label="主要导航">
          <button
            type="button"
            className={`nav-item ${isHome ? "is-active" : ""}`}
            onClick={onHome}
          >
            <LayoutGrid size={17} />
            <span>全部工具</span>
          </button>

          {tools.map((tool) => {
            const Icon = tool.icon;
            const active = !isHome && currentTool?.id === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                className={`nav-item ${active ? "is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => onToolSelect(tool.route)}
              >
                <Icon size={17} />
                <span>{tool.title}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />

        <div className="local-card">
          <div className="local-card-icon">
            <ShieldCheck size={17} />
          </div>
          <div>
            <strong>只在本机处理</strong>
            <p>文件不会上传；联网仅用于检查更新。</p>
          </div>
        </div>

        <button type="button" className="nav-item sidebar-about" onClick={onAbout}>
          <Info size={17} />
          <span>关于工具台</span>
        </button>

        <div className="sidebar-meta">
          <span>v0.8.0</span>
          <span className="meta-separator" />
          <LockKeyhole size={12} />
          <span>本地处理</span>
        </div>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}
