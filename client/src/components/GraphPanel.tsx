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

const stageLayout: Record<
  GraphNodeType,
  {
    x: number;
    y: number;
    maxRows: number;
    rowGap: number;
    columnGap: number;
  }
> = {
  BusinessPartner: { x: -1380, y: -40, maxRows: 12, rowGap: 70, columnGap: 84 },
  Plant: { x: -960, y: 520, maxRows: 12, rowGap: 64, columnGap: 78 },
  Product: { x: -620, y: 500, maxRows: 18, rowGap: 40, columnGap: 52 },
  SalesOrder: { x: -1040, y: -120, maxRows: 22, rowGap: 42, columnGap: 62 },
  SalesOrderItem: { x: -760, y: -110, maxRows: 26, rowGap: 34, columnGap: 46 },
  ScheduleLine: { x: -460, y: -160, maxRows: 28, rowGap: 30, columnGap: 38 },
  OutboundDelivery: { x: -120, y: -20, maxRows: 20, rowGap: 38, columnGap: 54 },
  OutboundDeliveryItem: { x: 180, y: 0, maxRows: 26, rowGap: 32, columnGap: 40 },
  BillingDocument: { x: 520, y: 0, maxRows: 24, rowGap: 34, columnGap: 48 },
  BillingDocumentItem: { x: 820, y: 10, maxRows: 28, rowGap: 30, columnGap: 36 },
  JournalEntry: { x: 1140, y: -40, maxRows: 24, rowGap: 34, columnGap: 44 },
  Payment: { x: 1440, y: 0, maxRows: 20, rowGap: 38, columnGap: 52 },
};

type PositionedGraphNode = GraphNode & {
  x: number;
  y: number;
  fx: number;
  fy: number;
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

const buildStageLayoutGraph = (graph: GraphData) => {
  const nodesByType = new Map<GraphNodeType, GraphNode[]>();
  const positionedNodes: PositionedGraphNode[] = [];

  for (const node of graph.nodes) {
    const typedNodes = nodesByType.get(node.type) ?? [];
    typedNodes.push(node);
    nodesByType.set(node.type, typedNodes);
  }

  for (const type of Object.keys(stageLayout) as GraphNodeType[]) {
    const typedNodes = (nodesByType.get(type) ?? []).slice().sort((left, right) =>
      left.id.localeCompare(right.id)
    );
    const config = stageLayout[type];

    typedNodes.forEach((node, index) => {
      const columnIndex = Math.floor(index / config.maxRows);
      const rowIndex = index % config.maxRows;
      const rowsInColumn = Math.min(
        config.maxRows,
        typedNodes.length - columnIndex * config.maxRows
      );
      const columnHeight = (rowsInColumn - 1) * config.rowGap;
      const x = config.x + columnIndex * config.columnGap;
      const y = config.y - columnHeight / 2 + rowIndex * config.rowGap;

      positionedNodes.push({
        ...node,
        x,
        y,
        fx: x,
        fy: y,
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

  const forceGraphData = useMemo(() => buildStageLayoutGraph(graph), [graph]);

  const focusGraph = () => {
    if (!graphRef.current?.zoomToFit || forceGraphData.nodes.length === 0) {
      return;
    }

    graphRef.current.zoomToFit(780, 96);

    window.setTimeout(() => {
      const currentZoom = graphRef.current?.zoom?.() ?? 1;
      graphRef.current?.zoom?.(currentZoom * 1.06, 180);
    }, 120);
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
    }, 80);

    return () => window.clearTimeout(focusTimeout);
  }, [forceGraphData.nodes.length, forceGraphData.links.length]);

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
                ? "rgba(79, 124, 255, 0.88)"
                : "rgba(125, 167, 244, 0.32)";
            }}
            linkWidth={(link) => {
              const sourceId = resolveNodeId((link as { source?: unknown }).source);
              const targetId = resolveNodeId((link as { target?: unknown }).target);

              return highlightedIds.has(sourceId) || highlightedIds.has(targetId)
                ? 2.4
                : 0.9;
            }}
            nodeCanvasObject={(node, context, globalScale) => {
              const graphNode = node as GraphNode;
              const x = (node as { x?: number }).x ?? 0;
              const y = (node as { y?: number }).y ?? 0;
              const isHighlighted = highlightedIds.has(graphNode.id);
              const isSelected = selectedNodeId === graphNode.id;
              const isHovered = hoveredNodeId === graphNode.id;
              const shouldShowLabel = isSelected || isHovered;
              const nodeRadius = isSelected ? 4.8 : isHighlighted ? 3.8 : 2.3;

              if (isHighlighted || isSelected) {
                context.beginPath();
                context.arc(x, y, nodeRadius + 2.8, 0, 2 * Math.PI, false);
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
