import type { ProcessStats } from "@/lib/types";

type StatsPanelProps = {
  stats: ProcessStats | null;
  compact?: boolean;
};

export function StatsPanel({ stats, compact = false }: StatsPanelProps) {
  if (!stats) {
    return (
      <section className="sidebar-section">
        <h2>Results</h2>
        <p className="muted">Triangle counts and timing appear here after processing.</p>
      </section>
    );
  }

  return (
    <section className={`sidebar-section ${compact ? "compact-stats" : ""}`}>
      <h2>Results</h2>
      <div className="stats">
        <div className="stat">
          <span className="muted">Before</span>
          <strong>{stats.facesBefore.toLocaleString()}</strong>
        </div>
        <div className="stat">
          <span className="muted">After</span>
          <strong>{stats.facesAfter.toLocaleString()}</strong>
        </div>
        <div className="stat">
          <span className="muted">Removed</span>
          <strong>{stats.facesRemoved.toLocaleString()}</strong>
        </div>
        <div className="stat">
          <span className="muted">Time</span>
          <strong>{stats.processingMs} ms</strong>
        </div>
      </div>
      {stats.componentsRemoved > 0 ? (
        <p className="muted tiny">
          Removed {stats.componentsRemoved} detached component
          {stats.componentsRemoved === 1 ? "" : "s"}.
        </p>
      ) : null}
    </section>
  );
}
