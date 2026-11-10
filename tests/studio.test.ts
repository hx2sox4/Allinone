import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrandMemory } from "@prisma/client";
import { approveBrief, createBrief, createVideoFromAsset, pickRatio, recommendModel, uploadToHiggsfield } from "@/lib/briefs";
import { db } from "@/lib/db";
import { HiggsfieldClient } from "@/lib/higgsfield/client";
import { getModel } from "@/lib/higgsfield/registry";
import { copyAssets, outputsOf, refreshJob, type Deps } from "@/lib/jobs";
import { LocalStorage } from "@/lib/storage";
import { saveComposedVersion } from "@/lib/versions";
import { wrapText } from "@/components/overlay";
import { startMockHiggsfield, type MockServer } from "../scripts/mock-higgsfield";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let mock: MockServer, deps: Deps, storage: LocalStorage, ws: string, user: string, brand: BrandMemory;

beforeAll(async () => {
  mock = await startMockHiggsfield({ pollsToComplete: 1 });
  storage = new LocalStorage(mkdtempSync(path.join(tmpdir(), "ilson-studio-")));
  deps = { hf: new HiggsfieldClient({ baseUrl: mock.url, keyId: "id", keySecret: "secret" }), storage, fetchImpl: fetch };
  const u = await db.user.create({ data: { email: `studio${Date.now()}@example.com`, name: "테스트", passwordHash: "x", memberships: { create: { role: "OWNER", workspace: { create: { name: "스튜디오 테스트" } } } } }, include: { memberships: true } });
  user = u.id;
  ws = u.memberships[0].workspaceId;
  brand = await db.brandMemory.create({ data: { workspaceId: ws, businessName: "딸기다방", industry: "카페·디저트", speechLevel: "존댓말", voice: "다정하게", audience: "근처 직장인", offers: "딸기 라떼", doSay: "", dontSay: "", channels: [], palette: ["#1f6f54", "#f4e9d8", "#2b2b2b"] } });
});
afterAll(async () => { await mock.close(); await db.$disconnect(); });

const args = (over: Partial<Parameters<typeof createBrief>[0]> = {}) => ({ workspaceId: ws, userId: user, brand, what: "딸기 라떼 출시 홍보", channel: "insta-feed", variants: 3, exactColors: false, productUrls: [] as string[], ...over });
async function finish(jobId: string) {
  for (let i = 0; i < 5; i++) if (await refreshJob(jobId, deps)) break;
  const job = await db.generationJob.findUniqueOrThrow({ where: { id: jobId } });
  await copyAssets(jobId, outputsOf(await deps.hf.status(job.hfRequestId!)), deps);
}

describe("모델 추천과 화면비", () => {
  it("제품 사진이 있으면 Ads Studio, 색상 고정이면 Recraft, 그 외에는 Z-Image Turbo", () => {
    expect(recommendModel({ hasProductPhotos: true, exactColors: true, paletteSize: 3 }).key).toBe("ads-studio");
    expect(recommendModel({ hasProductPhotos: false, exactColors: true, paletteSize: 3 }).key).toBe("recraft-v4-1");
    expect(recommendModel({ hasProductPhotos: false, exactColors: true, paletteSize: 2 }).key).toBe("z-image-turbo");
    expect(recommendModel({ hasProductPhotos: false, exactColors: false, paletteSize: 3 }).key).toBe("z-image-turbo");
    expect(recommendModel({ hasProductPhotos: true, exactColors: false, paletteSize: 0, override: "recraft-v4-1" }).key).toBe("recraft-v4-1");
  });
  it("모델이 지원하는 화면비만 고르고, 바꿨으면 이유를 남긴다", () => {
    expect(pickRatio(getModel("ads-studio"), "4:5")).toEqual({ ratio: "4:5", note: null });
    const z = pickRatio(getModel("z-image-turbo"), "4:5");
    expect(z.ratio).toBe("3:4");
    expect(z.note).toMatch(/4:5를 지원하지 않아 3:4/);
    expect(pickRatio(getModel("z-image-turbo"), "9:16").note).toBeNull();
  });
});

describe("브리프 → 시안 묶음", () => {
  it("Z-Image는 시안 수만큼 작업을 만들고 서로 다른 시드를 쓴다. 승인 전에는 제출하지 않는다", async () => {
    const before = mock.submissions.length;
    const brief = await createBrief(args(), deps);
    const jobs = await db.generationJob.findMany({ where: { briefId: brief.id } });
    expect(jobs.length).toBe(3);
    expect(jobs.every((j) => j.status === "ESTIMATED")).toBe(true);
    expect(new Set(jobs.map((j) => (j.input as { seed: number }).seed)).size).toBe(3);
    expect((jobs[0].input as { aspect_ratio: string }).aspect_ratio).toBe("3:4");
    expect(brief.ratioNote).toMatch(/3:4/);
    expect(jobs.reduce((a, j) => a + j.estimateKrw!, 0)).toBe(210);
    expect(mock.submissions.length).toBe(before);
    expect(await approveBrief(brief.id, deps)).toBe(3);
    expect(mock.submissions.length).toBe(before + 3);
    expect(await approveBrief(brief.id, deps)).toBe(0); // 다시 눌러도 중복 제출되지 않는다
  });

  it("제품 사진이 있으면 Ads Studio 작업 하나에 묶음 수, 참조 사진, 한국어, 업종과 고객을 넣는다", async () => {
    const url = await uploadToHiggsfield(PNG, "image/png", deps);
    const up = [...mock.uploads.values()].at(-1)!;
    expect(up.data.equals(PNG)).toBe(true);
    expect(up.headers.authorization).toBeUndefined(); // 업로드 주소에는 API 키를 보내지 않는다
    expect(up.headers["x-amz-tagging"]).toBe("retention=temporary");
    const brief = await createBrief(args({ productUrls: [url], variants: 4 }), deps);
    const jobs = await db.generationJob.findMany({ where: { briefId: brief.id } });
    expect(jobs.length).toBe(1);
    expect(jobs[0].input).toMatchObject({ batch_size: 4, aspect_ratio: "4:5", image_urls: [url], language: "Korean", niche: "카페·디저트", target_audience: "근처 직장인" });
    expect(jobs[0].estimateKrw).toBe(280);
    await approveBrief(brief.id, deps);
    await finish(jobs[0].id);
    expect(await db.asset.count({ where: { jobId: jobs[0].id } })).toBe(4);
  });

  it("색상 고정을 고르면 Recraft에 브랜드 색상 3가지를 RGB로 넣는다", async () => {
    const brief = await createBrief(args({ exactColors: true, variants: 1 }), deps);
    const [job] = await db.generationJob.findMany({ where: { briefId: brief.id } });
    expect(job.modelKey).toBe("recraft-v4-1");
    expect((job.input as { colors: unknown }).colors).toEqual([{ rgb: [31, 111, 84] }, { rgb: [244, 233, 216] }, { rgb: [43, 43, 43] }]);
  });

  it("내용이 비었거나 영상 모델을 고르면 거부하고 브리프를 남기지 않는다", async () => {
    const n = await db.brief.count({ where: { workspaceId: ws } });
    await expect(createBrief(args({ what: "  " }), deps)).rejects.toThrow(/무엇을/);
    await expect(createBrief(args({ modelOverride: "kling-2-5-turbo-i2v" }), deps)).rejects.toThrow(/이미지 모델/);
    await expect(createBrief(args({ what: "가".repeat(801) }), deps)).rejects.toThrow();
    expect(await db.brief.count({ where: { workspaceId: ws } })).toBe(n);
  });
});

describe("고른 시안으로 영상, 문구 버전", () => {
  let assetId: string;
  beforeAll(async () => {
    const brief = await createBrief(args({ variants: 1 }), deps);
    const [job] = await db.generationJob.findMany({ where: { briefId: brief.id } });
    await approveBrief(brief.id, deps);
    await finish(job.id);
    assetId = (await db.asset.findFirstOrThrow({ where: { jobId: job.id } })).id;
  });

  it("시안을 Higgsfield에 올려 시작 이미지로 쓰고, 같은 브리프에 영상 견적 작업을 만든다", async () => {
    const job = await createVideoFromAsset({ workspaceId: ws, userId: user, assetId, prompt: "천천히 회전" }, deps);
    expect(job.status).toBe("ESTIMATED");
    expect(job.sourceAssetId).toBe(assetId);
    expect(job.briefId).not.toBeNull();
    const url = (job.input as { image_url: string }).image_url;
    expect(url.startsWith(mock.url + "/files/upload-")).toBe(true);
    expect((await fetch(url)).status).toBe(200);
  });
  it("Kling은 움직임 설명이 필수이고, 다른 워크스페이스의 시안은 쓸 수 없다", async () => {
    await expect(createVideoFromAsset({ workspaceId: ws, userId: user, assetId, prompt: "" }, deps)).rejects.toThrow(/움직임/);
    const other = await db.workspace.create({ data: { name: "남의 가게" } });
    await expect(createVideoFromAsset({ workspaceId: other.id, userId: user, assetId, prompt: "p" }, deps)).rejects.toThrow(/찾을 수 없습니다/);
  });
  it("문구를 얹으면 원본은 남고 새 버전이 쌓인다", async () => {
    const v2 = await saveComposedVersion({ workspaceId: ws, assetId, png: PNG, overlayText: "딸기 라떼 출시", virtualPersonLabel: false }, storage);
    expect(v2).toMatchObject({ version: 2, parentAssetId: assetId, overlayText: "딸기 라떼 출시", approval: "PENDING" });
    // 버전 2에서 다시 편집해도 원본 아래에 버전 3으로 쌓인다.
    const v3 = await saveComposedVersion({ workspaceId: ws, assetId: v2.id, png: PNG, overlayText: "가상인물", virtualPersonLabel: true }, storage);
    expect(v3).toMatchObject({ version: 3, parentAssetId: assetId, virtualPersonLabel: true });
    expect((await storage.get(v3.storageKey)).equals(PNG)).toBe(true);
    expect((await db.asset.findUniqueOrThrow({ where: { id: assetId } })).version).toBe(1);
  });
  it("PNG가 아니거나 다른 워크스페이스면 저장하지 않는다", async () => {
    await expect(saveComposedVersion({ workspaceId: ws, assetId, png: Buffer.from("<html>"), overlayText: "", virtualPersonLabel: false }, storage)).rejects.toThrow(/PNG/);
    const other = await db.workspace.create({ data: { name: "남의 가게2" } });
    await expect(saveComposedVersion({ workspaceId: other.id, assetId, png: PNG, overlayText: "", virtualPersonLabel: false }, storage)).rejects.toThrow(/찾을 수 없습니다/);
  });
});

describe("한글 줄바꿈", () => {
  const measure = (s: string) => s.length * 10;
  it("띄어쓰기 단위로 나누고 너비를 넘지 않는다", () => {
    const lines = wrapText(measure, "봄 딸기 시즌 한정 라떼 출시", 60);
    expect(lines).toEqual(["봄 딸기", "시즌 한정", "라떼 출시"]);
    expect(lines.every((l) => measure(l) <= 60)).toBe(true);
  });
  it("띄어쓰기 없는 긴 말은 글자 단위로 나눈다", () => {
    expect(wrapText(measure, "가나다라마바사", 30)).toEqual(["가나다", "라마바", "사"]);
  });
  it("줄바꿈 문자를 지키고 빈 문구는 빈 배열이다", () => {
    expect(wrapText(measure, "첫 줄\n둘째 줄", 100)).toEqual(["첫 줄", "둘째 줄"]);
    expect(wrapText(measure, "   ", 100)).toEqual([]);
  });
});
