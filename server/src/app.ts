import express from "express";

import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/logger.js";
import { graphRouter } from "./routes/graph.routes.js";
import { healthRouter } from "./routes/health.routes.js";

const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";

export const createApp = () => {
  const app = express();

  app.use(requestLogger);
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", frontendOrigin);
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    return next();
  });
  app.use(express.json());

  app.use("/api/health", healthRouter);
  app.use("/api/graph", graphRouter);

  app.use(errorHandler);

  return app;
};
