import type { GraphNode } from "../types";

const formatLabel = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (match) => match.toUpperCase());

const renderValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") {
    return <span className="drawer-muted">Not available</span>;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return <span>{String(value)}</span>;
  }

  return <pre>{JSON.stringify(value, null, 2)}</pre>;
};

type NodeDetailDrawerProps = {
  node: GraphNode | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
};

export const NodeDetailDrawer = ({
  node,
  isLoading,
  error,
  onClose,
}: NodeDetailDrawerProps) => {
  if (!node) {
    return null;
  }

  const dataEntries = Object.entries(node.data).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return (
    <aside className="detail-drawer" aria-label={`Details for ${node.label}`}>
      <header className="detail-drawer__header">
        <div>
          <p className="detail-drawer__eyebrow">{node.type}</p>
          <h2>{node.label}</h2>
          <p className="detail-drawer__id">{node.id}</p>
        </div>

        <button type="button" className="ghost-button" onClick={onClose}>
          Close
        </button>
      </header>

      {isLoading && (
        <p className="detail-drawer__status">Refreshing node details…</p>
      )}
      {error && (
        <p className="detail-drawer__status detail-drawer__status--warning">
          {error}
        </p>
      )}

      <dl className="detail-drawer__grid">
        {dataEntries.map(([key, value]) => (
          <div key={key} className="detail-drawer__item">
            <dt>{formatLabel(key)}</dt>
            <dd>{renderValue(value)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
};
