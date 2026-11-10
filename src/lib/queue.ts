import type { Deps, OutputRef } from "./jobs";

// QUEUE_MODE=inline 이면 요청 안에서 바로 처리한다(개발과 테스트).
// QUEUE_MODE=bullmq 이면 Redis 작업 큐에 넣고 scripts/worker.ts가 처리한다.

const mode = () => process.env.QUEUE_MODE ?? "inline";

async function queues() {
  const { Queue } = await import("bullmq");
  const { default: IORedis } = await import("ioredis");
  const g = globalThis as unknown as { __q?: { copy: InstanceType<typeof Queue>; poll: InstanceType<typeof Queue> } };
  if (!g.__q) {
    const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
    g.__q = { copy: new Queue("asset-copy", { connection }), poll: new Queue("poll", { connection }) };
  }
  return g.__q;
}

export async function enqueueAssetCopy(jobId: string, outputs: OutputRef[], deps?: Deps) {
  if (mode() === "inline") {
    const { copyAssets } = await import("./jobs");
    await copyAssets(jobId, outputs, deps);
    return;
  }
  const q = await queues();
  await q.copy.add("copy", { jobId, outputs }, { jobId: `copy-${jobId}`, attempts: 8, backoff: { type: "exponential", delay: 5000 } });
}

export async function enqueuePoll(jobId: string) {
  if (mode() === "inline") return; // inline에서는 화면의 상태 조회가 폴링을 대신한다.
  const q = await queues();
  await q.poll.add("poll", { jobId }, { jobId: `poll-${jobId}`, delay: 5000, attempts: 200, backoff: { type: "fixed", delay: 5000 } });
}
