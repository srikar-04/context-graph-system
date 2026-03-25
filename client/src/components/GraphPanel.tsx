import { useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

import { NodeDetailDrawer } from "./NodeDetailDrawer";
import type { GraphData, GraphNode, GraphNodeType } from "../types";

const nodeColors: Record<GraphNodeType, string> = {
  BusinessPartner: "#7cb5ff",
  Plant: "#c8dcff",
  Product: "#ffb8c9",
  SalesOrder: "#5b93f8",
  SalesOrderItem: "#ff9db8",
  ScheduleLine: "#ffd3de",
  OutboundDelivery: "#8ebdff",
  OutboundDeliveryItem: "#ffb0c2",
  BillingDocument: "#4e86f0",
  BillingDocumentItem: "#ff91ad",
  JournalEntry: "#76a8ff",
  Payment: "#ff7c9f",
};

const legendTypes: GraphNodeType[] = [
  "SalesOrder",
  "BillingDocument",
  "JournalEntry",
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
  const hasInitializedViewRef = useRef(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const highlightedIds = new Set(highlightedNodeIds);

  const forceGraphData = {
    nodes: graph.nodes,
    links: graph.edges,
  };

  const focusGraph = () => {
    if (!graphRef.current?.zoomToFit || graph.nodes.length === 0) {
      return;
    }

    graphRef.current.zoomToFit(700, 84);

    window.setTimeout(() => {
      const currentZoom = graphRef.current?.zoom?.() ?? 1;
      graphRef.current?.zoom?.(currentZoom * 1.1, 280);
      graphRef.current?.centerAt?.(0, 0, 280);
    }, 760);
  };

  useEffect(() => {
    hasInitializedViewRef.current = false;

    if (!graphRef.current || graph.nodes.length === 0) {
      return;
    }

    graphRef.current.d3Force("link")?.distance(96);
    graphRef.current.d3Force("charge")?.strength(-195);
    graphRef.current.d3Force("center")?.strength(0.4);
    graphRef.current.d3ReheatSimulation?.();
  }, [graph.nodes.length, graph.edges.length]);

  return (
    <section className="graph-shell" aria-labelledby="graph-panel-title">
      <header className="graph-shell__header">
        <div className="graph-shell__title">
          <p className="surface-eyebrow">Graph</p>
          <h2 id="graph-panel-title">Order to Cash</h2>
        </div>

        <div className="graph-shell__controls">
          <div className="graph-shell__stats" aria-label="Graph summary">
            <span>{graph.nodes.length.toLocaleString("en-IN")} nodes</span>
            <span>{graph.edges.length.toLocaleString("en-IN")} edges</span>
            <span>{highlightedNodeIds.length.toLocaleString("en-IN")} highlighted</span>
          </div>
          <button type="button" className="mini-button" onClick={focusGraph}>
            Collapse
          </button>
          <button type="button" className="mini-button" onClick={onRetry}>
            Refresh
          </button>
          {highlightedNodeIds.length > 0 && (
            <button type="button" className="mini-button" onClick={onClearHighlights}>
              Clear
            </button>
          )}
        </div>
      </header>

      <div className="graph-shell__legend" aria-label="Node legend">
        {legendTypes.map((type) => (
          <span key={type} className="graph-shell__legend-item">
            <span
              className="graph-shell__legend-dot"
              style={{ backgroundColor: nodeColors[type] }}
              aria-hidden="true"
            />
            {type}
          </span>
        ))}
      </div>

      <div className="graph-surface">
        {isLoading && (
          <div className="empty-state" role="status">
            <h3>Loading graph...</h3>
            <p>Pulling the cached graph from the backend.</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="empty-state empty-state--error" role="alert">
            <h3>Graph unavailable</h3>
            <p>{error}</p>
            <button type="button" className="mini-button mini-button--solid" onClick={onRetry}>
              Retry
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
            cooldownTicks={prefersReducedMotion ? 55 : 180}
            d3VelocityDecay={prefersReducedMotion ? 0.62 : 0.24}
            onEngineStop={() => {
              if (!hasInitializedViewRef.current) {
                hasInitializedViewRef.current = true;
                focusGraph();
              }
            }}
            onNodeClick={(node) => onNodeSelect(node as GraphNode)}
            onNodeHover={(node) => {
              const graphNode = node as GraphNode | null;
              setHoveredNodeId(graphNode?.id ?? null);
            }}
            linkWidth={(link) => {
              const sourceId = resolveNodeId((link as { source?: unknown }).source);
              const targetId = resolveNodeId((link as { target?: unknown }).target);

              return highlightedIds.has(sourceId) || highlightedIds.has(targetId)
                ? 2.2
                : 1.1;
            }}
            linkColor={(link) => {
              const sourceId = resolveNodeId((link as { source?: unknown }).source);
              const targetId = resolveNodeId((link as { target?: unknown }).target);

              return highlightedIds.has(sourceId) || highlightedIds.has(targetId)
                ? "rgba(55, 120, 246, 0.92)"
                : "rgba(118, 181, 255, 0.44)";
            }}
            nodeCanvasObject={(node, context, globalScale) => {
              const graphNode = node as GraphNode;
              const x = (node as { x?: number }).x ?? 0;
              const y = (node as { y?: number }).y ?? 0;
              const isHighlighted = highlightedIds.has(graphNode.id);
              const isSelected = selectedNodeId === graphNode.id;
              const isHovered = hoveredNodeId === graphNode.id;
              const shouldShowLabel = isSelected || isHovered;
              const nodeRadius = isSelected ? 4.4 : isHighlighted ? 3.4 : 2.2;

              if (isHighlighted || isSelected) {
                context.beginPath();
                context.arc(x, y, nodeRadius + 3, 0, 2 * Math.PI, false);
                context.fillStyle = isSelected
                  ? "rgba(17, 24, 39, 0.12)"
                  : "rgba(85, 130, 255, 0.12)";
                context.fill();
              }

              context.beginPath();
              context.arc(x, y, nodeRadius, 0, 2 * Math.PI, false);
              context.fillStyle = nodeColors[graphNode.type];
              context.fill();

              if (!shouldShowLabel) {
                return;
              }

              const fontSize = 10 / globalScale;
              const label = graphNode.label;
              const textWidth = context.measureText(label).width;
              const backgroundWidth = textWidth + 12 / globalScale;
              const backgroundHeight = 18 / globalScale;
              const textY = y - nodeRadius - 10 / globalScale;

              context.font = `500 ${fontSize}px "Space Grotesk"`;
              context.fillStyle = "rgba(255, 255, 255, 0.96)";
              context.fillRect(
                x - backgroundWidth / 2,
                textY - backgroundHeight / 2,
                backgroundWidth,
                backgroundHeight
              );
              context.strokeStyle = "rgba(17, 24, 39, 0.08)";
              context.strokeRect(
                x - backgroundWidth / 2,
                textY - backgroundHeight / 2,
                backgroundWidth,
                backgroundHeight
              );
              context.fillStyle = "rgba(17, 24, 39, 0.92)";
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
