import { getGraph, getGraphNode, setGraph } from "../graph/cache.js";
import type { GraphData, GraphNode } from "../types/graph.js";
import { buildGraph } from "./graphBuilder.js";

export const rebuildGraphCache = async (): Promise<GraphData> => {
  const graph = await buildGraph();
  setGraph(graph);

  return graph;
};

export const getCachedGraph = (): GraphData | null => getGraph();

export const getCachedGraphNode = (id: string): GraphNode | null =>
  getGraphNode(id);
