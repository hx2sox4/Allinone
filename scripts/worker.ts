// 작업 큐 처리기. 실행: npm run worker (QUEUE_MODE=bullmq 일 때 필요)
import "./load-env";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { copyAssets, refreshJob } from "../src/lib/jobs";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });

new Worker("asset-copy", async (job) => copyAssets(job.data.jobId, job.data.outputs), { connection });
new Worker(
  "poll",
  async (job) => {
    const done = await refreshJob(job.data.jobId);
    if (!done) throw new Error("아직 진행 중"); // 실패로 처리해 정해진 간격으로 다시 조회한다.
  },
  { connection },
);
console.log("작업 처리기가 시작됐습니다 (asset-copy, poll)");
