import "dotenv/config";

import { createApp } from "./app.js";
import { rebuildGraphCache } from "./services/graphCacheService.js";

const port = Number(process.env.PORT ?? "3000");

const app = createApp();

const startServer = async () => {
  await rebuildGraphCache();

  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
};

void startServer().catch((error) => {
  console.error("Failed to start server");
  console.error(error);
  process.exit(1);
});
