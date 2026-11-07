import { useMemo, useState } from "react";
import type { ToolManifest } from "../tools/types";
import { CATEGORY_LABELS } from "../tools/types";
import {
  ArrowRight,
  ArrowUpRight,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

interface HomePageProps {
  tools: ToolManifest[];
  roadmap: ToolManifest[];
  onOpenTool: (route: string) => void;
}

export function HomePage({ tools, roadmap, onOpenTool }: HomePageProps) {
  const [query, setQuery] = useState("");
  const showSearch = tools.length >= 6;
  const normalizedQuery = query.trim().toLowerCase();

  const filteredTools = useMemo(() => {
    if (!normalizedQuery) {
      return tools;
    }
    return tools.filter((tool) => {
      const searchable = [tool.title, tool.description, ...tool.keywords]
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [normalizedQuery, tools]);

  return (
    <div className="home page-enter">
      <header className="home-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-mark" />
            本地工具台
          </div>
          <h1>工具</h1>
          <p className="home-subtitle">
            选择一个工具开始。所有文件只留在这台电脑上。
          </p>
        </div>

        <div className="local-stamp">
          <ShieldCheck size={19} />
          <span>
            <strong>LOCAL ONLY</strong>
            <small>无上传 · 无账号</small>
          </span>
        </div>
      </header>

      <section className="tools-section" aria-labelledby="tools-heading">
        <div className="section-heading">
          <div>
            <h2 id="tools-heading">全部工具</h2>
            <span>{tools.length} 个可用</span>
          </div>

          {showSearch ? (
            <label className="search-box">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">搜索工具</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索工具"
                type="search"
              />
              {query ? (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="清除搜索"
                  onClick={() => setQuery("")}
                >
                  <X size={14} />
                </button>
              ) : null}
            </label>
          ) : (
            <span className="section-note">从一件小事开始</span>
          )}
        </div>

        <div className="tool-layout">
          {filteredTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                className="tool-card"
                onClick={() => onOpenTool(tool.route)}
              >
                <div className="tool-card-top">
                  <span className="tool-icon">
                    <Icon size={24} strokeWidth={1.8} />
                  </span>
                  <span className="tool-category">
                    {CATEGORY_LABELS[tool.category]}
                  </span>
                </div>

                <div className="tool-card-copy">
                  <h3>{tool.title}</h3>
                  <p>{tool.description}</p>
                </div>

                <div className="tool-card-foot">
                  <span>打开工具</span>
                  <span className="tool-arrow">
                    <ArrowUpRight size={18} />
                  </span>
                </div>
              </button>
            );
          })}

          {tools.length < 3 && !normalizedQuery ? (
            <aside className="roadmap-card" aria-label="即将加入的工具">
              <div className="roadmap-head">
                <span className="roadmap-icon">
                  <Sparkles size={17} />
                </span>
                <span>正在打磨</span>
              </div>
              <h3>下一批小工具</h3>
              <ul>
                {roadmap.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <li key={tool.id}>
                      <span className="roadmap-tool-icon">
                        <Icon size={15} />
                      </span>
                      <span>{tool.title}</span>
                      <ArrowRight size={14} className="roadmap-arrow" />
                    </li>
                  );
                })}
              </ul>
              <p>按同一套工具注册表加入，不改变首页结构。</p>
            </aside>
          ) : null}
        </div>

        {filteredTools.length === 0 ? (
          <div className="empty-search">
            <Search size={22} />
            <p>没有找到“{query}”相关的工具。</p>
            <button type="button" className="text-button" onClick={() => setQuery("")}>
              清除搜索
            </button>
          </div>
        ) : null}
      </section>

      <footer className="home-footer">
        <span className="footer-dot" />
        <span>本地工具 · 无需登录 · 文件不上传</span>
        <span className="footer-spacer" />
        <span>0.8.0</span>
      </footer>
    </div>
  );
}
