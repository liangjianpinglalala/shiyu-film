import { Queue, Worker } from "bullmq";
import { config } from "../lib/server/config";
import { JobService, processOne } from "../lib/server/jobs";
import { database } from "../lib/server/db";
async function main() {
  const jobs = new JobService();
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  process.on("SIGINT", () => {
    stopping = true;
  });
  if (config().redisUrl) {
    const url = new URL(config().redisUrl!);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: url.username || undefined,
      password: decodeURIComponent(url.password) || undefined,
      ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    };
    const queue = new Queue("shiyu-generation", { connection });
    const worker = new Worker(
      "shiyu-generation",
      async (job) => {
        await processOne(jobs, undefined, job.data.id);
      },
      { connection, concurrency: 2 },
    );
    worker.on("error", () =>
      console.error(
        "Queue connection unavailable; pending jobs remain in database.",
      ),
    );
    while (!stopping) {
      try {
        for (const job of await jobs.pending())
          await queue.add(
            "generate",
            { id: job.id },
            { jobId: job.id, removeOnComplete: true, removeOnFail: true },
          );
      } catch {
        console.error("Queue reconciliation deferred.");
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    await worker.close();
    await queue.close();
  } else {
    console.log("Local durable worker started.");
    while (!stopping) {
      try {
        await processOne(jobs);
      } catch {
        console.error("Worker deferred; retrying database operation.");
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await database().close();
}
main().catch(() => {
  console.error("Worker startup failed. Check server configuration.");
  process.exitCode = 1;
});
