import { Router } from "express";

import { asyncHandler } from "../utils/asyncHandler.js";
import {
  getCachedGraph,
  getCachedGraphNode,
  rebuildGraphCache,
} from "../services/graphCacheService.js";

export const graphRouter = Router();

graphRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const graph = getCachedGraph() ?? (await rebuildGraphCache());

    res.json(graph);
  })
);

graphRouter.get(
  "/node/:id",
  asyncHandler(async (req, res) => {
    const graph = getCachedGraph() ?? (await rebuildGraphCache());
    const nodeId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;

    if (!nodeId) {
      return res.status(400).json({
        error: "Graph node id is required",
        code: "GRAPH_NODE_ID_REQUIRED",
      });
    }

    const node = getCachedGraphNode(nodeId);

    if (!node) {
      return res.status(404).json({
        error: "Graph node not found",
        code: "GRAPH_NODE_NOT_FOUND",
        graphSize: graph.nodes.length,
      });
    }

    return res.json(node);
  })
);

graphRouter.post(
  "/rebuild",
  asyncHandler(async (_req, res) => {
    const graph = await rebuildGraphCache();

    res.json({
      success: true,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
    });
  })
);
