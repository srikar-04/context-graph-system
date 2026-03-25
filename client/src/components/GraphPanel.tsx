import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

import { NodeDetailDrawer } from "./NodeDetailDrawer";
import type { GraphData, GraphNode, GraphNodeType } from "../types";

const nodeColors: Record<GraphNodeType, string> = {
  BusinessPartner: "#7c93f6",
  Plant: "#a8b5d4",
  Product: "#f3b45f",
  SalesOrder: "#4f7cff",
  SalesOrderItem: "#7eb0ff",
  ScheduleLine: "#bfd6ff",
  OutboundDelivery: "#7c5cff",
  OutboundDeliveryItem: "#b6a6ff",
  BillingDocument: "#f97316",
  BillingDocumentItem: "#fdba74",
  JournalEntry: "#14b8a6",
  Payment: "#ec4899",
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
  const highlightedIds = useMemo(
    () => new Set(highlightedNodeIds),
    [highlightedNodeIds]
  );

  const forceGraphData = useMemo(
    () => ({
      nodes: graph.nodes,
      links: graph.edges,
    }),
    [graph.edges, graph.nodes]
  );

  const focusGraph = () => {
    if (!graphRef.current?.zoomToFit || graph.nodes.length === 0) {
      return;
    }

    graphRef.current.zoomToFit(900, 132);

    window.setTimeout(() => {
      const currentZoom = graphRef.current?.zoom?.() ?? 1;
      graphRef.current?.zoom?.(currentZoom * 1.1, 360);
      graphRef.current?.centerAt?.(0, 0, 360);
    }, 860);
  };

  useEffect(() => {
    hasInitializedViewRef.current = false;

    if (!graphRef.current || graph.nodes.length === 0) {
      return;
    }

    graphRef.current.d3Force("link")?.distance(154);
    graphRef.current.d3Force("link")?.strength(0.16);
    graphRef.current.d3Force("charge")?.strength(-360);
    graphRef.current.d3Force("center")?.strength(0.08);
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
            nodeId="id"
            linkSource="source"
            linkTarget="target"
            backgroundColor="transparent"
            nodeLabel={(node) => {
              const graphNode = node as GraphNode;
              return `${graphNode.type}: ${graphNode.label}`;
            }}
            cooldownTicks={prefersReducedMotion ? 80 : 260}
            warmupTicks={prefersReducedMotion ? 12 : 64}
            d3VelocityDecay={prefersReducedMotion ? 0.58 : 0.18}
            minZoom={0.12}
            maxZoom={6}
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
            linkCanvasObjectMode={() => "replace"}
            linkCanvasObject={(link, context, globalScale) => {
              const sourceNode = (link as { source?: { x?: number; y?: number } }).source;
              const targetNode = (link as { target?: { x?: number; y?: number } }).target;
              const sourceId = resolveNodeId((link as { source?: unknown }).source);
              const targetId = resolveNodeId((link as { target?: unknown }).target);
              const sourceX = sourceNode?.x;
              const sourceY = sourceNode?.y;
              const targetX = targetNode?.x;
              const targetY = targetNode?.y;

              if (
                typeof sourceX !== "number" ||
                typeof sourceY !== "number" ||
                typeof targetX !== "number" ||
                typeof targetY !== "number"
              ) {
                return;
              }

              const isHighlighted =
                highlightedIds.has(sourceId) || highlightedIds.has(targetId);

              context.save();
              context.beginPath();
              context.moveTo(sourceX, sourceY);
              context.lineTo(targetX, targetY);
              context.strokeStyle = isHighlighted
                ? "rgba(79, 124, 255, 0.22)"
                : "rgba(96, 165, 250, 0.18)";
              context.lineWidth = (isHighlighted ? 6.2 : 3.4) / globalScale;
              context.stroke();

              context.beginPath();
              context.moveTo(sourceX, sourceY);
              context.lineTo(targetX, targetY);
              context.strokeStyle = isHighlighted
                ? "rgba(79, 124, 255, 0.94)"
                : "rgba(96, 165, 250, 0.62)";
              context.lineWidth = (isHighlighted ? 2.6 : 1.4) / globalScale;
              context.stroke();
              context.restore();
            }}
            nodeCanvasObject={(node, context, globalScale) => {
              const graphNode = node as GraphNode;
              const x = (node as { x?: number }).x ?? 0;
              const y = (node as { y?: number }).y ?? 0;
              const isHighlighted = highlightedIds.has(graphNode.id);
              const isSelected = selectedNodeId === graphNode.id;
              const isHovered = hoveredNodeId === graphNode.id;
              const shouldShowLabel = isSelected || isHovered;
              const nodeRadius = isSelected ? 4.6 : isHighlighted ? 3.6 : 2.4;

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
