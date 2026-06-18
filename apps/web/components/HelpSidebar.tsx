type HelpSidebarProps = {
  compact?: boolean;
};

export function HelpSidebar({ compact = false }: HelpSidebarProps) {
  return (
    <section className={`sidebar-section ${compact ? "help-compact" : ""}`}>
      <h2>Chief Architect tips</h2>
      <ol className="help-list">
        <li>Open a <strong>3D camera view</strong> before exporting.</li>
        <li>
          Hide <strong>Interior Walls</strong>, <strong>Basement</strong>, fences, and landscaping
          in your active layer set.
        </li>
        <li>Use <strong>File → Export → 3D Model</strong> as OBJ or STL.</li>
        <li>Upload here to remove leftover interior geometry and fill the house into one solid printable model.</li>
      </ol>
      {!compact ? (
        <p className="muted tiny">
          Open roofs or cutaway views may keep interior walls because they become visible from outside.
          Fine exterior trim may soften slightly when the model is solidified.
        </p>
      ) : null}
    </section>
  );
}
