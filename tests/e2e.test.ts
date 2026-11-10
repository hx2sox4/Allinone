import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import { db } from "@/lib/db";
import { HiggsfieldClient, HiggsfieldError } from "@/lib/higgsfield/client";
import { applyStatus, cancelJob, copyAssets, createEstimatedJob, idempotencyKeyFor, outputsOf, refreshJob, submitJob, type Deps } from "@/lib/jobs";
import { LocalStorage } from "@/lib/storage";
import { POST as webhookPOST } from "@/app/api/webhooks/higgsfield/route";
import { startMockHiggsfield, type MockServer } from "../scripts/mock-higgsfield";

let mock: MockServer;
let deps: Deps;
let storage: LocalStorage;
let ws: string;
let user: string;

beforeAll(async () => {
  mock = await startMockHiggsfield({ pollsToComplete: 2 });
  storage = new LocalStorage(mkdtempSync(path.join(tmpdir(), "ilson-test-")));
  process.env.STORAGE_DRIVER = "local";
  deps = { hf: new HiggsfieldClient({ baseUrl: mock.url, keyId: "id", keySecret: "secret" }), storage, fetchImpl: fetch };
  const u = await db.user.create({ data: { email: `t${Date.now()}@example.com`, name: "테스트", passwordHash: "x", memberships: { create: { role: "OWNER", workspace: { create: { name: "테스트 가게" } } } } }, include: { memberships: true } });
  user = u.id;
  ws = u.memberships[0].workspaceId;
});

afterAll(async () => {
  await mock.close();
  await db.$disconnect();
});

async function pollUntilDone(jobId: string) {
  for (let i = 0; i < 10; i++) if (await refreshJob(jobId, deps)) return;
  throw new Error("작업이 끝나지 않았습니다");
}
// inline 큐는 기본 저장소를 쓰므로, 테스트에서는 복사를 테스트 저장소로 직접 수행한다.
async function copyFor(jobId: string) {
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
  const s = await deps.hf.status(job.hfRequestId!);
  return copyAssets(jobId, outputsOf(s), deps);
}

describe("이미지 생성: 견적 → 승인 → 조회 → 자산 복사", () => {
  it("끝까지 진행되고 결과 파일이 우리 저장소에 남는다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "z-image-turbo", input: { prompt: "딸기 라떼", aspect_ratio: "1:1" } }, deps);
    expect(job.status).toBe("ESTIMATED");
    expect(job.estimateKrw).toBe(70); // 모의 견적 0.050달러 × 1400
    expect(mock.submissions.length).toBe(0); // 승인 전에는 제출하지 않는다

    const submitted = await submitJob(job.id, deps);
    expect(submitted.status).toBe("QUEUED");
    expect(mock.submissions[0].idempotencyKey).toBe(idempotencyKeyFor(job.id));

    process.env.STORAGE_LOCAL_DIR = (storage as unknown as { dir: string }).dir;
    await pollUntilDone(job.id);
    await copyFor(job.id);
    const done = await db.generationJob.findUniqueOrThrow({ where: { id: job.id }, include: { assets: true } });
    expect(done.status).toBe("COMPLETED");
    expect(done.hfExpiresAt).toBeInstanceOf(Date);
    expect(done.assets.length).toBe(1);
    expect(done.assets[0].kind).toBe("IMAGE");
    expect(done.assets[0].aiGenerated).toBe(true);
    const bytes = await storage.get(done.assets[0].storageKey);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    // 같은 파일을 다시 복사해도 중복 저장되지 않는다.
    expect(await copyFor(job.id)).toBe(0);
  });

  it("같은 작업을 두 번 승인해도 한 번만 제출된다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "z-image-turbo", input: { prompt: "중복 제출" } }, deps);
    const before = mock.submissions.length;
    const a = await submitJob(job.id, deps);
    const b = await submitJob(job.id, deps);
    expect(mock.submissions.length).toBe(before + 1);
    expect(b.hfRequestId).toBe(a.hfRequestId);
  });

  it("시간 초과로 다시 보내도 같은 멱등 키면 같은 요청이 돌아온다", async () => {
    const key = idempotencyKeyFor("retry-case");
    const a = await deps.hf.submit("/z-image/turbo", { prompt: "재시도" }, { idempotencyKey: key });
    const b = await deps.hf.submit("/z-image/turbo", { prompt: "재시도" }, { idempotencyKey: key });
    expect(b.request_id).toBe(a.request_id);
  });
});

describe("영상 생성: 서명된 웹훅으로 완료", () => {
  it("웹훅을 검증해 반영하고, 같은 웹훅이 두 번 와도 한 번만 처리한다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "kling-2-5-turbo-i2v", input: { prompt: "천천히 회전", image_url: "https://example.com/p.png", duration: 5 } }, deps);
    expect(job.estimateKrw).toBe(490);
    const submitted = await submitJob(job.id, deps);
    const rid = submitted.hfRequestId!;
    process.env.HF_API_BASE = mock.url;
    process.env.HF_API_KEY_ID = "id";
    process.env.HF_API_KEY_SECRET = "secret";

    const body = JSON.stringify({ request_id: rid, status: "completed", error: null, expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(), payload: { video: { url: `${mock.url}/files/${rid}.mp4` } } });
    const now = new Date();
    const wid = `msg_video_${now.getTime()}`; // 테스트 DB는 지우지 않으므로 실행마다 다른 id를 쓴다
    const headers = { "content-type": "application/json", "webhook-id": wid, "webhook-timestamp": String(Math.floor(now.getTime() / 1000)), "webhook-signature": new Webhook(process.env.HF_WEBHOOK_SECRET!).sign(wid, now, body) };
    const send = () => webhookPOST(new Request("http://app/api/webhooks/higgsfield", { method: "POST", headers, body }));

    const first = await send();
    expect(first.status).toBe(200);
    const second = await send();
    expect((await second.json()).duplicate).toBe(true);

    const done = await db.generationJob.findUniqueOrThrow({ where: { id: job.id }, include: { assets: true } });
    expect(done.status).toBe("COMPLETED");
    expect(done.assets.length).toBe(1);
    expect(done.assets[0].kind).toBe("VIDEO");
    expect(done.assets[0].contentType).toBe("video/mp4");
  });

  it("서명이 틀린 웹훅은 401로 거부하고 작업을 바꾸지 않는다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "kling-2-5-turbo-i2v", input: { prompt: "p", image_url: "https://example.com/p.png" } }, deps);
    const submitted = await submitJob(job.id, deps);
    const body = JSON.stringify({ request_id: submitted.hfRequestId, status: "completed", payload: { video: { url: "https://evil.example/x.mp4" } } });
    const res = await webhookPOST(new Request("http://app/api/webhooks/higgsfield", { method: "POST", headers: { "webhook-id": "msg_bad", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,AAAA" }, body }));
    expect(res.status).toBe(401);
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("QUEUED");
  });
});

describe("실패, 심의, 취소", () => {
  it("심의에 걸린 작업은 NSFW로 끝나고 자산이 없으며 다시 시도하지 않는다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "z-image-turbo", input: { prompt: "[nsfw] 테스트" } }, deps);
    await submitJob(job.id, deps);
    const before = mock.submissions.length;
    await pollUntilDone(job.id);
    const done = await db.generationJob.findUniqueOrThrow({ where: { id: job.id }, include: { assets: true } });
    expect(done.status).toBe("NSFW");
    expect(done.error).toMatch(/비용은 청구되지 않습니다/);
    expect(done.assets.length).toBe(0);
    expect(mock.submissions.length).toBe(before);
  });
  it("실패한 작업은 FAILED로 끝난다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "z-image-turbo", input: { prompt: "[fail] 테스트" } }, deps);
    await submitJob(job.id, deps);
    await pollUntilDone(job.id);
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
  });
  it("대기 중인 작업은 취소된다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "z-image-turbo", input: { prompt: "취소" } }, deps);
    await submitJob(job.id, deps);
    expect((await cancelJob(job.id, deps)).status).toBe("CANCELED");
  });
  it("끝난 작업은 늦게 온 진행 중 알림으로 되돌아가지 않는다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "z-image-turbo", input: { prompt: "[fail] 순서" } }, deps);
    const s = await submitJob(job.id, deps);
    await pollUntilDone(job.id);
    await applyStatus(s.hfRequestId!, { status: "in_progress" });
    expect((await db.generationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
  });
  it("모델 스키마에 맞지 않는 입력은 견적 전에 거부된다", async () => {
    await expect(createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "z-image-turbo", input: { prompt: "p", aspect_ratio: "4:5" } }, deps)).rejects.toThrow();
  });
});

describe("결과 복사 상태", () => {
  it("완료 직후 복사가 덜 끝났으면 '보관하는 중'으로 판단하고, 웹훅과 조회가 겹쳐도 중복 저장하지 않는다", async () => {
    const { isCopyPending } = await import("@/lib/jobs");
    expect(isCopyPending({ status: "COMPLETED", outputCount: 3 }, 1)).toBe(true);
    expect(isCopyPending({ status: "COMPLETED", outputCount: 3 }, 3)).toBe(false);
    expect(isCopyPending({ status: "COMPLETED", outputCount: null }, 0)).toBe(false);
    expect(isCopyPending({ status: "NSFW", outputCount: null }, 0)).toBe(false);

    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "ads-studio", input: { prompt: "묶음", batch_size: 4 } }, deps);
    const s = await submitJob(job.id, deps);
    for (let i = 0; i < 5; i++) if (await refreshJob(job.id, deps)) break;
    const outputs = outputsOf(await deps.hf.status(s.hfRequestId!));
    // 같은 결과를 동시에 두 번 복사한다.
    await Promise.all([copyAssets(job.id, outputs, deps), copyAssets(job.id, outputs, deps)]);
    const done = await db.generationJob.findUniqueOrThrow({ where: { id: job.id }, include: { assets: true } });
    expect(done.outputCount).toBe(4);
    expect(done.assets.length).toBe(4);
  });
});

describe("실제 응답에서 확인한 예외 형태", () => {
  it("금액 없이 설명만 오는 견적은 원화 없이 설명을 저장한다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "seedance-2-i2v", input: { image_url: "https://example.com/a.png", prompt: "천천히 확대" } }, deps);
    expect(job.status).toBe("ESTIMATED");
    expect(job.estimateKrw).toBeNull();
    expect(job.estimateUsd).toBeNull();
    expect(job.estimateNote).toContain("사용량");
  });

  it("잔액 부족(403 not_enough_credits)이면 승인 전 상태로 두고 사유를 남긴다", async () => {
    const job = await createEstimatedJob({ workspaceId: ws, userId: user, modelKey: "z-image-turbo", input: { prompt: "잔액 부족" } }, deps);
    const hf = Object.assign(Object.create(deps.hf), {
      submit: async () => { throw new HiggsfieldError(403, '{"detail":"not_enough_credits"}'); },
    }) as HiggsfieldClient;
    const after = await submitJob(job.id, { ...deps, hf });
    expect(after.status).toBe("ESTIMATED");
    expect(after.hfRequestId).toBeNull();
    expect(after.error).toContain("잔액");
    // 충전 뒤 다시 누르면 정상 제출되고 사유가 지워진다.
    const retried = await submitJob(job.id, deps);
    expect(retried.hfRequestId).toBeTruthy();
    expect(retried.error).toBeNull();
  });
});
