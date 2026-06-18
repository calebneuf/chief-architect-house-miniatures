"use client";

import type { MeshComponent } from "@/lib/types";

type ComponentCleanupPanelProps = {
  components: MeshComponent[];
  excludedIds: number[];
  selectedComponentId?: number | null;
  disabled?: boolean;
  onExcludedChange: (ids: number[]) => void;
  onSelectComponent?: (id: number | null) => void;
};

function formatExtents(extents: number[]): string {
  const [x, y, z] = extents;
  return `${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)}`;
}

export function ComponentCleanupPanel({
  components,
  excludedIds,
  selectedComponentId = null,
  disabled = false,
  onExcludedChange,
  onSelectComponent,
}: ComponentCleanupPanelProps) {
  const excluded = new Set(excludedIds);

  const toggle = (id: number) => {
    if (excluded.has(id)) {
      onExcludedChange(excludedIds.filter((item) => item !== id));
      return;
    }
    onExcludedChange([...excludedIds, id]);
  };

  const selectSmallParts = () => {
    if (components.length < 2) {
      return;
    }
    const largestFootprint = components[0]?.footprint ?? 0;
    const threshold = largestFootprint * 0.08;
    const smallIds = components
      .filter((component) => component.footprint < threshold)
      .map((component) => component.id);
    onExcludedChange(smallIds);
  };

  return (
    <section className="sidebar-section cleanup-panel">
      <div className="cleanup-header">
        <h2>Manual cleanup</h2>
        <button
          type="button"
          className="text-button"
          disabled={disabled || components.length < 2}
          onClick={selectSmallParts}
        >
          Select small parts
        </button>
      </div>
      <p className="muted tiny">
        Click parts in the preview and press <kbd>Delete</kbd>, or check them here. Remove fences,
        trees, and detached site objects before processing.
      </p>
      <ul className="component-list">
        {components.map((component, index) => (
          <li
            key={component.id}
            className={`component-row${selectedComponentId === component.id ? " selected" : ""}${excluded.has(component.id) ? " excluded" : ""}`}
          >
            <input
              type="checkbox"
              checked={excluded.has(component.id)}
              disabled={disabled}
              onChange={() => toggle(component.id)}
              aria-label={`Remove part ${component.id + 1}`}
            />
            <span
              className="component-label"
              onClick={() => onSelectComponent?.(component.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectComponent?.(component.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <strong>
                {index === 0 ? "Main shell" : `Part ${component.id + 1}`}
              </strong>
              <span className="muted tiny">
                {component.faces.toLocaleString()} faces · {formatExtents(component.extents)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {excludedIds.length > 0 ? (
        <p className="muted tiny">
          {excludedIds.length} part{excludedIds.length === 1 ? "" : "s"} will be removed.
        </p>
      ) : null}
    </section>
  );
}
