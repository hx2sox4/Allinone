import { Prisma, type AssetKind, type GenerationJob, type JobStatus } from "@prisma/client";
import { db } from "./db";
import { HF_TERMINAL, HiggsfieldClient, HiggsfieldError, configFromEnv, type HfStatus } from "./higgsfield/client";
import { getModel, validateInput } from "./higgsfield/registry";
import { rateFromEnv, usdToKrw } from "./money";
import { storageFromEnv, type Storage } from "./storage";
import { enqueueAssetCopy, enqueuePoll } from "./queue";

export interface Deps {
  hf: HiggsfieldClient;
  storage: Storage;
  fetchImpl: typeof fetch;
}

let cached: Deps | undefined;
export function defaultDeps(): Deps {
  cached ??= { hf: new HiggsfieldClient(configFromEnv()), storage: storageFromEnv(), fetchImpl: fetch };
  return cached;
}

const STATUS_MAP: Record<HfStatus, JobStatus> = {
  queued: "QUEUED",
  in_progress: "IN_PROGRESS",
  completed: "COMPLETED",
  failed: "FAILED",
  nsfw: "NSFW",
  canceled: "CANCELED",
};
const TERMINAL: JobStatus[] = ["COMPLETED", "FAILED", "NSFW", "CANCELED"];
export const isTerminal = (s: JobStatus) => TERMINAL.includes(s);

/** Higgsfield 제출에 쓰는 멱등 키. 같은 작업은 몇 번을 다시 보내도 같은 키다. */
export const idempotencyKeyFor = (jobId: string) => `ilson-job-${jobId}`;

/** 1단계: 입력을 검증하고 견적만 받는다. 아직 과금되는 요청은 보내지 않는다. */
export async function createEstimatedJob(
  args: { workspaceId: string; userId: string; modelKey: string; input: unknown },
  deps: Deps = defaultDeps(),
): Promise<GenerationJob> {
  const model = getModel(args.modelKey);
  const input = validateInput(args.modelKey, args.input);
  const { usd, note } = await deps.hf.estimate(model.endpoint, input);
  return db.generationJob.create({
    data: {
      workspaceId: args.workspaceId,
      createdById: args.userId,
      modelKey: model.key,
      input: input as Prisma.InputJsonValue,
      status: "ESTIMATED",
      estimateUsd: usd,
      estimateKrw: usd === null ? null : usdToKrw(usd, rateFromEnv()),
      estimateNote: note,
    },
  });
}

/** 2단계: 사용자가 견적을 승인하면 제출한다. */
export async function submitJob(jobId: string, deps: Deps = defaultDeps()): Promise<GenerationJob> {
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status !== "ESTIMATED") return job; // 이미 제출된 작업은 다시 제출하지 않는다.
  const model = getModel(job.modelKey);
  const base = process.env.APP_PUBLIC_URL;
  let handle;
  try {
    handle = await deps.hf.submit(model.endpoint, job.input, {
      idempotencyKey: idempotencyKeyFor(job.id),
      webhookUrl: base ? `${base.replace(/\/$/, "")}/api/webhooks/higgsfield` : undefined,
    });
  } catch (e) {
    // 잔액 부족은 403 {"detail":"not_enough_credits"}로 온다(2026-11-10 실제 호출로 확인). 작업은 승인 전 상태로 둔다.
    if (e instanceof HiggsfieldError && e.httpStatus === 403 && e.body.includes("not_enough_credits")) {
      return db.generationJob.update({ where: { id: job.id }, data: { error: "Higgsfield 잔액이 부족해서 만들지 못했습니다. 충전한 뒤 다시 눌러 주세요." } });
    }
    throw e;
  }
  const updated = await db.generationJob.update({
    where: { id: job.id },
    data: {
      status: STATUS_MAP[handle.status] ?? "QUEUED",
      error: null,
      hfRequestId: handle.request_id,
      statusUrl: handle.status_url,
      cancelUrl: handle.cancel_url,
      submittedAt: new Date(),
    },
  });
  await enqueuePoll(job.id); // 웹훅이 오지 않을 때를 대비한 조회
  return updated;
}

export interface StatusUpdate {
  status: HfStatus;
  error?: unknown;
  expires_at?: string | null;
  images?: { url: string; content_type?: string }[];
  video?: { url: string };
}

/** 웹훅과 조회가 함께 쓰는 상태 반영. 여러 번 불려도 결과가 같다. */
export async function applyStatus(requestId: string, u: StatusUpdate, deps?: Deps): Promise<GenerationJob | null> {
  const job = await db.generationJob.findUnique({ where: { hfRequestId: requestId } });
  if (!job) return null;
  const next = STATUS_MAP[u.status];
  if (!next) return job;
  // 끝난 작업은 되돌리지 않는다. 늦게 온 in_progress 알림이 completed를 덮어쓰면 안 된다.
  if (isTerminal(job.status)) return job;
  const terminal = HF_TERMINAL.includes(u.status);
  const updated = await db.generationJob.update({
    where: { id: job.id },
    data: {
      status: next,
      lastCheckedAt: new Date(),
      hfExpiresAt: u.expires_at ? new Date(u.expires_at) : job.hfExpiresAt,
      error: u.status === "failed" ? stringifyError(u.error) : u.status === "nsfw" ? "심의 기준에 걸려 생성되지 않았습니다. 비용은 청구되지 않습니다." : job.error,
      finishedAt: terminal ? new Date() : null,
      outputCount: u.status === "completed" ? outputsOf(u).length : undefined,
    },
  });
  if (u.status === "completed") {
    const outputs = outputsOf(u);
    if (outputs.length > 0) await enqueueAssetCopy(job.id, outputs, deps);
  }
  return updated;
}

function stringifyError(e: unknown): string {
  if (!e) return "생성에 실패했습니다. 비용은 청구되지 않습니다.";
  return typeof e === "string" ? e : JSON.stringify(e);
}

export interface OutputRef {
  url: string;
  kind: AssetKind;
  contentType?: string;
}

export function outputsOf(u: StatusUpdate): OutputRef[] {
  const out: OutputRef[] = [];
  for (const img of u.images ?? []) if (img?.url) out.push({ url: img.url, kind: "IMAGE", contentType: img.content_type });
  if (u.video?.url) out.push({ url: u.video.url, kind: "VIDEO" });
  return out;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov" };

/** Higgsfield는 결과 파일을 7일 뒤 지운다. 완료 즉시 우리 저장소로 복사한다. 같은 파일은 한 번만 저장된다. */
export async function copyAssets(jobId: string, outputs: OutputRef[], deps: Deps = defaultDeps()): Promise<number> {
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
  let copied = 0;
  for (const [i, o] of outputs.entries()) {
    const exists = await db.asset.findUnique({ where: { jobId_sourceUrl: { jobId, sourceUrl: o.url } } });
    if (exists) continue;
    const res = await deps.fetchImpl(o.url);
    if (!res.ok) throw new Error(`결과 파일을 내려받지 못했습니다 (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = (res.headers.get("content-type") ?? o.contentType ?? (o.kind === "VIDEO" ? "video/mp4" : "image/png")).split(";")[0].trim();
    const key = `${job.workspaceId}/${job.id}/${i}.${EXT[contentType] ?? "bin"}`;
    await deps.storage.put(key, buf, contentType);
    try {
      await db.asset.create({
        data: { workspaceId: job.workspaceId, jobId, kind: o.kind, storageKey: key, contentType, bytes: buf.length, sourceUrl: o.url },
      });
      copied++;
    } catch (e) {
      // 웹훅과 조회가 동시에 같은 파일을 복사한 경우. 먼저 저장된 쪽을 그대로 둔다.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return copied;
}

/** 조회(폴링). 끝나지 않은 작업의 상태를 Higgsfield에서 다시 읽는다. true면 끝난 것이다. */
export async function refreshJob(jobId: string, deps: Deps = defaultDeps()): Promise<boolean> {
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
  if (isTerminal(job.status)) return true;
  if (!job.hfRequestId) return false;
  const s = await deps.hf.status(job.hfRequestId);
  const updated = await applyStatus(job.hfRequestId, s, deps);
  return !!updated && isTerminal(updated.status);
}

/** 대기 중일 때만 취소된다. 취소된 요청은 Higgsfield가 환불한다. */
export async function cancelJob(jobId: string, deps: Deps = defaultDeps()): Promise<GenerationJob> {
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status === "ESTIMATED") return db.generationJob.update({ where: { id: jobId }, data: { status: "CANCELED", finishedAt: new Date() } });
  if (job.status !== "QUEUED" || !job.hfRequestId) return job;
  await deps.hf.cancel(job.hfRequestId);
  return db.generationJob.update({ where: { id: jobId }, data: { status: "CANCELED", finishedAt: new Date() } });
}

/** 완료됐지만 결과 파일이 아직 우리 저장소로 다 옮겨지지 않았는지. 화면은 이 동안 "보관하는 중"으로 보여 준다. */
export const isCopyPending = (job: { status: JobStatus; outputCount: number | null }, originals: number) =>
  job.status === "COMPLETED" && job.outputCount !== null && originals < job.outputCount;
