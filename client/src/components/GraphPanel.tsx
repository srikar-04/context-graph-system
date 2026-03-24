import { useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

import { NodeDetailDrawer } from "./NodeDetailDrawer";
import type { GraphData, GraphNode, GraphNodeType } from "../types";

const nodeColors: Record<GraphNodeType, string> = {
  BusinessPartner: "#0f766e",
  Plant: "#2563eb",
  Product: "#ca8a04",
  SalesOrder: "#7c3aed",
  SalesOrderItem: "#8b5cf6",
  ScheduleLine: "#ec4899",
  OutboundDelivery: "#f97316",
  OutboundDeliveryItem: "#fb923c",
  BillingDocument: "#dc2626",
  BillingDocumentItem: "#f87171",
  JournalEntry: "#0284c7",
  Payment: "#059669",
};

const legendTypes: GraphNodeType[] = [
  "BusinessPartner",
  "Product",
  "SalesOrder",
  "OutboundDelivery",
  "BillingDocument",
  "Payment",
];

const resolveNodeId = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : "";
  }

  return "";
};

const usePrefersReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);

    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
};

type GraphPanelProps = {
  graph: GraphData;
  isLoading: boolean;
  error: string | null;
  selectedNode: GraphNode | null;
  selectedNodeId: string | null;
  isLoadingNode: boolean;
  nodeError: string | null;
  highlightedNodeIds: string[];
  onNodeSelect: (node: GraphNode) => void;
  onCloseNode: () => void;
  onRetry: () => void;
  onClearHighlights: () => void;
};

export const GraphPanel = ({
  graph,
  isLoading,
  error,
  selectedNode,
  selectedNodeId,
  isLoadingNode,
  nodeError,
  highlightedNodeIds,
  onNodeSelect,
  onCloseNode,
  onRetry,
  onClearHighlights,
}: GraphPanelProps) => {
  const graphRef = useRef<any>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const forceGraphData = {
    nodes: graph.nodes,
    links: graph.edges,
  };

  useEffect(() => {
    if (graph.nodes.length === 0 || !graphRef.current?.zoomToFit) {
      return;
    }

    const timeout = window.setTimeout(() => {
      graphRef.current?.zoomToFit?.(700, 96);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [graph.nodes.length]);

  const highlightedIds = new Set(highlightedNodeIds);

  return (
    <section className="panel panel--graph" aria-labelledby="graph-panel-title">
      <header className="panel__header">
        <div>
          <p className="panel__eyebrow">Visual Trace</p>
          <h2 id="graph-panel-title">Order-to-Cash Graph</h2>
          <p className="panel__copy">
            Click any node to inspect its business context and trace where the
            current answer lands in the flow.
          </p>
        </div>

        <div className="panel__actions">
          <button type="button" className="ghost-button" onClick={onRetry}>
            Refresh Graph
          </button>
          {highlightedNodeIds.length > 0 && (
            <button type="button" className="ghost-button" onClick={onClearHighlights}>
              Clear Highlights
            </button>
          )}
        </div>
      </header>

      <div className="graph-panel__toolbar">
        <div className="graph-stats" aria-label="Graph summary">
          <span>{graph.nodes.length.toLocaleString("en-IN")} nodes</span>
          <span>{graph.edges.length.toLocaleString("en-IN")} edges</span>
          <span>{highlightedNodeIds.length.toLocaleString("en-IN")} highlighted</span>
        </div>

        <div className="graph-legend" aria-label="Node legend">
          {legendTypes.map((type) => (
            <span key={type} className="legend-pill">
              <span
                className="legend-pill__swatch"
                style={{ backgroundColor: nodeColors[type] }}
                aria-hidden="true"
              />
              {type}
            </span>
          ))}
        </div>
      </div>

      <div className="graph-surface">
        {isLoading && (
          <div className="empty-state" role="status">
            <h3>Loading the context graph…</h3>
            <p>The frontend is pulling the cached graph from the backend.</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="empty-state empty-state--error" role="alert">
            <h3>Graph unavailable</h3>
            <p>{error}</p>
            <button type="button" className="primary-button" onClick={onRetry}>
              Try Again
            </button>
          </div>
        )}

        {!isLoading && !error && (
          <ForceGraph2D
            ref={graphRef}
            graphData={forceGraphData}
            backgroundColor="transparent"
            nodeLabel={(node) => {
              const graphNode = node as GraphNode;
              return `${graphNode.type}: ${graphNode.label}`;
            }}
            cooldownTicks={prefersReducedMotion ? 40 : 120}
            d3VelocityDecay={prefersReducedMotion ? 0.55 : 0.34}
            linkDirectionalParticles={0}
            onNodeClick={(node) => onNodeSelect(node as GraphNode)}
            onNodeHover={(node) => {
              const graphNode = node as GraphNode | null;
              setHoveredNodeId(graphNode?.id ?? null);
            }}
            linkWidth={(link) => {
              const sourceId = resolveNodeId((link as { source?: unknown }).source);
              const targetId = resolveNodeId((link as { target?: unknown }).target);

              return highlightedIds.has(sourceId) || highlightedIds.has(targetId)
                ? 1.9
                : 0.8;
            }}
            linkColor={(link) => {
              const sourceId = resolveNodeId((link as { source?: unknown }).source);
              const targetId = resolveNodeId((link as { target?: unknown }).target);

              return highlightedIds.has(sourceId) || highlightedIds.has(targetId)
                ? "rgba(249, 115, 22, 0.75)"
                : "rgba(75, 85, 99, 0.28)";
            }}
            nodeCanvasObject={(node, context, globalScale) => {
              const graphNode = node as GraphNode;
              const x = (node as { x?: number }).x ?? 0;
              const y = (node as { y?: number }).y ?? 0;
              const isHighlighted = highlightedIds.has(graphNode.id);
              const isSelected = selectedNodeId === graphNode.id;
              const isHovered = hoveredNodeId === graphNode.id;
              const shouldShowLabel = isHighlighted || isSelected || isHovered;
              const nodeRadius = isSelected ? 7.5 : isHighlighted ? 6.6 : 5.2;

              if (isHighlighted || isSelected) {
                context.beginPath();
                context.arc(x, y, nodeRadius + 4.5, 0, 2 * Math.PI, false);
                context.fillStyle = isSelected
                  ? "rgba(250, 204, 21, 0.36)"
                  : "rgba(56, 189, 248, 0.28)";
                context.fill();
              }

              context.beginPath();
              context.arc(x, y, nodeRadius, 0, 2 * Math.PI, false);
              context.fillStyle = nodeColors[graphNode.type];
              context.fill();

              context.lineWidth = isSelected ? 2.2 : 1.1;
              context.strokeStyle = "rgba(255, 251, 235, 0.92)";
              context.stroke();

              if (!shouldShowLabel) {
                return;
              }

              const fontSize = 12 / globalScale;
              const label = graphNode.label;

              context.font = `600 ${fontSize}px "Space Grotesk"`;
              const textWidth = context.measureText(label).width;
              const backgroundWidth = textWidth + 16 / globalScale;
              const backgroundHeight = 22 / globalScale;
              const textY = y - nodeRadius - 10 / globalScale;

              context.fillStyle = "rgba(15, 23, 42, 0.9)";
              context.fillRect(
                x - backgroundWidth / 2,
                textY - backgroundHeight / 2,
                backgroundWidth,
                backgroundHeight
              );

              context.fillStyle = "rgba(248, 250, 252, 0.96)";
              context.textAlign = "center";
              context.textBaseline = "middle";
              context.fillText(label, x, textY);
            }}
          />
        )}

        <NodeDetailDrawer
          node={selectedNode}
          isLoading={isLoadingNode}
          error={nodeError}
          onClose={onCloseNode}
        />
      </div>
    </section>
  );
};
