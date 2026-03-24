import { useEffect, useState } from "react";

import { getErrorMessage, getGraph, getGraphNode } from "../api/client";
import type { GraphData, GraphNode } from "../types";

const emptyGraph: GraphData = {
  nodes: [],
  edges: [],
};

export const useGraph = () => {
  const [graph, setGraph] = useState<GraphData>(emptyGraph);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLoadingNode, setIsLoadingNode] = useState(false);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([]);

  const loadGraph = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextGraph = await getGraph();
      setGraph(nextGraph);
    } catch (nextError) {
      setError(
        getErrorMessage(
          nextError,
          "The graph could not be loaded. Check that the backend is running."
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadGraph();
  }, []);

  const selectNode = async (node: GraphNode) => {
    setSelectedNodeId(node.id);
    setSelectedNode(node);
    setNodeError(null);
    setIsLoadingNode(true);

    try {
      const detailedNode = await getGraphNode(node.id);
      setSelectedNode(detailedNode);
    } catch (nextError) {
      setNodeError(
        getErrorMessage(
          nextError,
          "The live node lookup failed, so the cached node data is shown instead."
        )
      );
      setSelectedNode(node);
    } finally {
      setIsLoadingNode(false);
    }
  };

  const closeSelectedNode = () => {
    setSelectedNode(null);
    setSelectedNodeId(null);
    setNodeError(null);
    setIsLoadingNode(false);
  };

  return {
    graph,
    isLoading,
    error,
    loadGraph,
    selectedNode,
    selectedNodeId,
    isLoadingNode,
    nodeError,
    selectNode,
    closeSelectedNode,
    highlightedNodeIds,
    setHighlightedNodeIds,
  };
};
