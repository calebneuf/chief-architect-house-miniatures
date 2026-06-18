export function HelpSidebar() {
  return (
    <div className="panel">
      <h2>Chief Architect export checklist</h2>
      <ol className="help-list">
        <li>
          Open your plan in a <strong>3D camera view</strong> before exporting.
        </li>
        <li>
          Create a layer set that hides <strong>Interior Walls</strong>, furniture, and
          fixtures you do not want in the miniature.
        </li>
        <li>
          Set that layer set active. Chief Architect only exports geometry visible in the
          current 3D layer set.
        </li>
        <li>
          Use <strong>File → Export → 3D Model</strong> and choose OBJ or STL.
        </li>
        <li>
          Upload the exported file here. The service still removes interior partition walls
          that were left in the export.
        </li>
      </ol>
      <p className="muted" style={{ marginTop: "1rem" }}>
        Tip: exports with open roofs or cutaway views may keep interior walls because they
        become visible from outside.
      </p>
    </div>
  );
}
