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

const clusterCenters: Record<GraphNodeType, { x: number; y: number }> = {
  BusinessPartner: { x: -1120, y: -120 },
  Plant: { x: -500, y: 520 },
  Product: { x: -120, y: 520 },
  SalesOrder: { x: -760, y: -200 },
  SalesOrderItem: { x: -360, y: -110 },
  ScheduleLine: { x: -80, y: -340 },
  OutboundDelivery: { x: 130, y: 60 },
  OutboundDeliveryItem: { x: 460, y: 180 },
  BillingDocument: { x: 780, y: -20 },
  BillingDocumentItem: { x: 1080, y: 120 },
  JournalEntry: { x: 1400, y: -80 },
  Payment: { x: 1700, y: 120 },
};

const clusterPhaseOffset: Record<GraphNodeType, number> = {
  BusinessPartner: -0.18,
  Plant: 0.82,
  Product: 1.08,
  SalesOrder: 0.05,
  SalesOrderItem: 0.4,
  ScheduleLine: 0.92,
  OutboundDelivery: 1.42,
  OutboundDeliveryItem: 1.78,
  BillingDocument: 0.2,
  BillingDocumentItem: 0.66,
  JournalEntry: 1.08,
  Payment: 1.54,
};

type PositionedGraphNode = GraphNode & {
  x: number;
  y: number;
};

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

const buildClusteredGraph = (graph: GraphData) => {
  const positionedNodes: PositionedGraphNode[] = [];
  const nodesByType = new Map<GraphNodeType, GraphNode[]>();

  for (const node of graph.nodes) {
    const typedNodes = nodesByType.get(node.type) ?? [];
    typedNodes.push(node);
    nodesByType.set(node.type, typedNodes);
  }

  for (const type of Object.keys(clusterCenters) as GraphNodeType[]) {
    const typedNodes = nodesByType.get(type) ?? [];
    const center = clusterCenters[type];
    const phaseOffset = clusterPhaseOffset[type];

    typedNodes.forEach((node, index) => {
      const ring = Math.floor(index / 22);
      const ringStartIndex = ring * 22;
      const ringIndex = index - ringStartIndex;
      const pointsOnRing = Math.max(10, 16 + ring * 8);
      const angle =
        (ringIndex / pointsOnRing) * Math.PI * 2 + phaseOffset + ring * 0.14;
      const radius = 34 + ring * 46;

      positionedNodes.push({
        ...node,
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    });
  }

  return {
    nodes: positionedNodes,
    links: graph.edges,
  };
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
  const highlightedIds = useMemo(
    () => new Set(highlightedNodeIds),
    [highlightedNodeIds]
  );

  const forceGraphData = useMemo(() => buildClusteredGraph(graph), [graph]);

  const focusGraph = () => {
    if (!graphRef.current?.zoomToFit || forceGraphData.nodes.length === 0) {
      return;
    }

    graphRef.current.zoomToFit(720, 124);

    window.setTimeout(() => {
      const currentZoom = graphRef.current?.zoom?.() ?? 1;
      graphRef.current?.zoom?.(currentZoom * 1.08, 240);
      graphRef.current?.centerAt?.(320, 40, 240);
    }, 140);
  };

  useEffect(() => {
    hasInitializedViewRef.current = false;

    if (!graphRef.current || forceGraphData.nodes.length === 0) {
      return;
    }

    const focusTimeout = window.setTimeout(() => {
      if (!hasInitializedViewRef.current) {
        hasInitializedViewRef.current = true;
        focusGraph();
      }
    }, 90);

    return () => window.clearTimeout(focusTimeout);
  }, [forceGraphData.nodes.length]);

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
            enableNodeDrag={false}
            enablePanInteraction
            enableZoomInteraction
            cooldownTicks={0}
            warmupTicks={0}
            minZoom={0.12}
            maxZoom={6}
            nodeLabel={(node) => {
              const graphNode = node as GraphNode;
              return `${graphNode.type}: ${graphNode.label}`;
            }}
            onNodeClick={(node) => onNodeSelect(node as GraphNode)}
            onNodeHover={(node) => {
              const graphNode = node as GraphNode | null;
              setHoveredNodeId(graphNode?.id ?? null);
            }}
            linkColor={(link) => {
              const sourceId = resolveNodeId((link as { source?: unknown }).source);
              const targetId = resolveNodeId((link as { target?: unknown }).target);

              return highlightedIds.has(sourceId) || highlightedIds.has(targetId)
                ? "rgba(79, 124, 255, 0.98)"
                : "rgba(125, 167, 244, 0.72)";
            }}
            linkWidth={(link) => {
              const sourceId = resolveNodeId((link as { source?: unknown }).source);
              const targetId = resolveNodeId((link as { target?: unknown }).target);

              return highlightedIds.has(sourceId) || highlightedIds.has(targetId)
                ? 3.2
                : 1.55;
            }}
            nodeCanvasObject={(node, context, globalScale) => {
              const graphNode = node as GraphNode;
              const x = (node as { x?: number }).x ?? 0;
              const y = (node as { y?: number }).y ?? 0;
              const isHighlighted = highlightedIds.has(graphNode.id);
              const isSelected = selectedNodeId === graphNode.id;
              const isHovered = hoveredNodeId === graphNode.id;
              const shouldShowLabel = isSelected || isHovered;
              const nodeRadius = isSelected ? 4.8 : isHighlighted ? 3.8 : 2.6;

              if (isHighlighted || isSelected) {
                context.beginPath();
                context.arc(x, y, nodeRadius + 3.4, 0, 2 * Math.PI, false);
                context.fillStyle = isSelected
                  ? "rgba(17, 24, 39, 0.12)"
                  : "rgba(85, 130, 255, 0.14)";
                context.fill();
              }

              context.beginPath();
              context.arc(x, y, nodeRadius, 0, 2 * Math.PI, false);
              context.fillStyle = nodeColors[graphNode.type];
              context.fill();

              if (!shouldShowLabel) {
                return;
              }

              context.font = `500 ${10 / globalScale}px "Space Grotesk"`;
              const label = graphNode.label;
              const textWidth = context.measureText(label).width;
              const backgroundWidth = textWidth + 12 / globalScale;
              const backgroundHeight = 18 / globalScale;
              const textY = y - nodeRadius - 10 / globalScale;

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
