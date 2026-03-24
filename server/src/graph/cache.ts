import type { GraphData, GraphNode } from "../types/graph.js";

let graphCache: GraphData | null = null;
let nodeCache = new Map<string, GraphNode>();

export const getGraph = (): GraphData | null => graphCache;

export const getGraphNode = (id: string): GraphNode | null =>
  nodeCache.get(id) ?? null;

export const setGraph = (graph: GraphData) => {
  graphCache = graph;
  nodeCache = new Map(graph.nodes.map((node) => [node.id, node]));
};

export const clearGraph = () => {
  graphCache = null;
  nodeCache = new Map();
};
