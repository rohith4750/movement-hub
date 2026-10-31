import { prisma } from "@movement-hub/database";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { startJobs } from "./jobs/scheduler.js";

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`Movement Hub API → http://localhost:${env.PORT}/api/v1`);
});
const stopJobs = env.NODE_ENV === "test" ? () => {} : startJobs();

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopJobs();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
