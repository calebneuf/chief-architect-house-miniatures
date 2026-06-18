import type { ProcessStats } from "@/lib/types";

type StatsPanelProps = {
  stats: ProcessStats | null;
};

export function StatsPanel({ stats }: StatsPanelProps) {
  if (!stats) {
    return (
      <div className="panel">
        <h2>Processing stats</h2>
        <p className="muted">Upload a model to see triangle counts and timing.</p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Processing stats</h2>
      <div className="stats">
        <div className="stat">
          <span className="muted">Triangles before</span>
          <strong>{stats.facesBefore.toLocaleString()}</strong>
        </div>
        <div className="stat">
          <span className="muted">Triangles after</span>
          <strong>{stats.facesAfter.toLocaleString()}</strong>
        </div>
        <div className="stat">
          <span className="muted">Faces removed</span>
          <strong>{stats.facesRemoved.toLocaleString()}</strong>
        </div>
        <div className="stat">
          <span className="muted">Processing time</span>
          <strong>{stats.processingMs} ms</strong>
        </div>
      </div>
      {stats.componentsRemoved > 0 ? (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Removed {stats.componentsRemoved} small floating component
          {stats.componentsRemoved === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}
