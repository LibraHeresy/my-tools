import type { PackSummary } from '../types'

export interface JobState {
  kind: 'pack'
  running: boolean
  /** 进度条下方那行小字：本次任务的描述 */
  label: string
  done: number
  total: number
  packSummary?: PackSummary
}

interface Props {
  job: JobState | null
  onClose: () => void
}

export function JobPanel({ job, onClose }: Props) {
  if (!job) return null

  const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0

  return (
    <section className="job-panel">
      <header>
        <h3>合成图集</h3>
        <span className={job.running ? 'job-state running' : 'job-state'}>
          {job.running ? `进行中 ${job.done}/${job.total}` : '已完成'}
        </span>
        <button className="close" onClick={onClose} title="关闭面板">
          ×
        </button>
      </header>

      {job.running && (
        <>
          <div className="progress">
            <div style={{ width: `${percent}%` }} />
          </div>
          <div className="job-current">{job.label || '正在准备…'}</div>
        </>
      )}

      {job.packSummary && <PackResult summary={job.packSummary} />}
    </section>
  )
}

function PackResult({ summary }: { summary: PackSummary }) {
  const failed = summary.warnings.length > 0 && summary.pages.length === 0

  return (
    <>
      {failed ? (
        <div className="job-summary bad">{summary.warnings.join('；')}</div>
      ) : (
        <div className="job-summary">
          <b>{summary.frameCount}</b> 个精灵 / <b>{summary.pages.length}</b> 页 · 用时{' '}
          {summary.elapsedMs} ms
          <span className="dim"> · {summary.outDir}</span>
        </div>
      )}

      {summary.pages.length > 0 && (
        <div className="page-list">
          {summary.pages.map((p, i) => (
            <span className="page-chip" key={`${p.imageName}-${i}`}>
              {p.imageName} · {p.width}×{p.height} · {p.frames} 个精灵
            </span>
          ))}
        </div>
      )}

      {summary.warnings.length > 0 && !failed && (
        <div className="job-warnings">
          {summary.warnings.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
    </>
  )
}
