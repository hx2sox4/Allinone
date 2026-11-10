import type { BrandMemory, Brief, Prisma } from "@prisma/client";
import { db } from "./db";
import { getModel, validateInput, type ModelSpec } from "./higgsfield/registry";
import { createEstimatedJob, defaultDeps, submitJob, type Deps } from "./jobs";

// 채널별 권장 화면비. 사용자가 고르는 출발점일 뿐이고, 실제로는 모델 스키마가 지원하는 값만 보낸다.
export const CHANNELS: { key: string; label: string; ratio: string }[] = [
  { key: "insta-feed", label: "인스타그램 피드", ratio: "4:5" },
  { key: "insta-reels", label: "인스타 릴스 · 유튜브 쇼츠", ratio: "9:16" },
  { key: "square", label: "정사각형 (스마트스토어 · 쿠팡 대표 이미지)", ratio: "1:1" },
  { key: "blog", label: "네이버 블로그 · 가로형", ratio: "16:9" },
];

const FALLBACK: Record<string, string[]> = { "4:5": ["3:4", "1:1"], "9:16": ["2:3", "1:1"], "16:9": ["3:2", "1:1"], "1:1": [] };

/** 원하는 화면비를 모델이 지원하면 그대로, 아니면 가장 가까운 지원 값으로 바꾸고 그 사실을 알린다. */
export function pickRatio(model: ModelSpec, wanted: string): { ratio: string; note: string | null } {
  const f = model.fields.aspect_ratio;
  if (f?.type !== "enum") return { ratio: wanted, note: `${model.name}은 화면비를 지정할 수 없습니다.` };
  if (f.values.includes(wanted)) return { ratio: wanted, note: null };
  const alt = (FALLBACK[wanted] ?? []).find((r) => f.values.includes(r)) ?? f.default ?? f.values[0];
  return { ratio: alt, note: `${model.name}은 ${wanted}를 지원하지 않아 ${alt}로 만듭니다.` };
}

/** 작업에 맞는 모델 추천. 사용자가 직접 고르면 그 선택을 따른다. */
export function recommendModel(args: { hasProductPhotos: boolean; exactColors: boolean; paletteSize: number; override?: string }): { key: string; reason: string } {
  if (args.override) return { key: getModel(args.override).key, reason: "직접 선택한 모델입니다." };
  if (args.hasProductPhotos) return { key: "ads-studio", reason: "제품 사진을 참조해 광고 시안을 묶음으로 만드는 모델이라 골랐습니다." };
  if (args.exactColors && args.paletteSize >= 3) return { key: "recraft-v4-1", reason: "브랜드 색상 3가지를 직접 지정할 수 있는 모델이라 골랐습니다." };
  return { key: "z-image-turbo", reason: "빠르게 시안을 보는 용도의 모델이라 골랐습니다." };
}

const hexToRgb = (h: string) => ({ rgb: [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) });

export interface BriefArgs {
  workspaceId: string;
  userId: string;
  brand: BrandMemory;
  what: string;
  channel: string;
  variants: number;
  exactColors: boolean;
  /** Higgsfield에 올려 둔 제품 사진 주소 */
  productUrls: string[];
  modelOverride?: string;
}

/** 브리프 하나를 시안 작업들로 풀고 견적까지 받는다. 승인 전에는 아무것도 제출하지 않는다. */
export async function createBrief(args: BriefArgs, deps: Deps = defaultDeps()): Promise<Brief> {
  const channel = CHANNELS.find((c) => c.key === args.channel);
  if (!channel) throw new Error("채널을 선택해 주세요");
  const variants = Math.min(4, Math.max(1, Math.floor(args.variants)));
  const what = args.what.trim();
  if (!what) throw new Error("무엇을 만들지 적어 주세요");
  const rec = recommendModel({ hasProductPhotos: args.productUrls.length > 0, exactColors: args.exactColors, paletteSize: args.brand.palette.length, override: args.modelOverride });
  const model = getModel(rec.key);
  if (model.kind !== "image") throw new Error("브리프의 시안은 이미지 모델로 만듭니다. 영상은 고른 시안에서 만듭니다.");
  const { ratio, note } = pickRatio(model, channel.ratio);

  const base: Record<string, unknown> = { prompt: what };
  if (model.fields.aspect_ratio) base.aspect_ratio = ratio;
  if ("language" in model.fields) base.language = "Korean";
  if ("niche" in model.fields) base.niche = args.brand.industry;
  if ("target_audience" in model.fields) base.target_audience = args.brand.audience;
  if ("image_urls" in model.fields && args.productUrls.length > 0) base.image_urls = args.productUrls;
  if ("colors" in model.fields && args.brand.palette.length >= 3) base.colors = args.brand.palette.slice(0, 3).map(hexToRgb);

  // 묶음 생성을 지원하면 작업 하나로, 아니면 시안 수만큼 작업을 만든다.
  const inputs: Record<string, unknown>[] = [];
  if ("batch_size" in model.fields) inputs.push({ ...base, batch_size: variants });
  else for (let i = 0; i < variants; i++) inputs.push("seed" in model.fields ? { ...base, seed: Math.floor(Math.random() * 2147483647) } : { ...base });
  for (const input of inputs) validateInput(model.key, input); // 견적을 받기 전에 전부 검증한다.

  const brief = await db.brief.create({
    data: { workspaceId: args.workspaceId, createdById: args.userId, what, channel: channel.label, ratio, ratioNote: note, modelKey: model.key, modelReason: rec.reason, variants },
  });
  try {
    for (const input of inputs) {
      const job = await createEstimatedJob({ workspaceId: args.workspaceId, userId: args.userId, modelKey: model.key, input }, deps);
      await db.generationJob.update({ where: { id: job.id }, data: { briefId: brief.id } });
    }
  } catch (e) {
    await db.brief.delete({ where: { id: brief.id } });
    throw e;
  }
  return brief;
}

/** 브리프의 견적 대기 작업을 모두 제출한다. */
export async function approveBrief(briefId: string, deps: Deps = defaultDeps()): Promise<number> {
  const jobs = await db.generationJob.findMany({ where: { briefId, status: "ESTIMATED" } });
  for (const j of jobs) await submitJob(j.id, deps);
  return jobs.length;
}

/** 고른 시안(이미지)을 시작 이미지로 영상 작업을 만든다. 견적까지만 받는다. */
export async function createVideoFromAsset(
  args: { workspaceId: string; userId: string; assetId: string; prompt: string; modelKey?: string },
  deps: Deps = defaultDeps(),
) {
  const asset = await db.asset.findFirst({ where: { id: args.assetId, workspaceId: args.workspaceId }, include: { job: true } });
  if (!asset) throw new Error("시안을 찾을 수 없습니다");
  if (asset.kind !== "IMAGE") throw new Error("영상은 이미지 시안에서만 만들 수 있습니다");
  const model = getModel(args.modelKey ?? "kling-2-5-turbo-i2v");
  if (model.kind !== "video" || !model.fields.image_url) throw new Error("이미지에서 영상을 만드는 모델이 아닙니다");
  const prompt = args.prompt.trim();
  if (model.fields.prompt?.required && !prompt) throw new Error("영상에서 어떤 움직임을 원하는지 적어 주세요");
  const data = await deps.storage.get(asset.storageKey);
  const imageUrl = await uploadToHiggsfield(data, asset.contentType, deps);
  const input: Record<string, unknown> = { image_url: imageUrl };
  if (prompt) input.prompt = prompt;
  const job = await createEstimatedJob({ workspaceId: args.workspaceId, userId: args.userId, modelKey: model.key, input }, deps);
  return db.generationJob.update({ where: { id: job.id }, data: { briefId: asset.job.briefId, sourceAssetId: asset.id } });
}

const HF_UPLOAD_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

/** 우리 저장소의 파일을 Higgsfield에 올리고 참조용 주소를 받는다. 업로드 주소에는 API 키를 보내지 않는다. */
export async function uploadToHiggsfield(data: Buffer, contentType: string, deps: Deps = defaultDeps()): Promise<string> {
  if (!HF_UPLOAD_TYPES.includes(contentType)) throw new Error(`Higgsfield가 받지 않는 파일 형식입니다: ${contentType}`);
  const u = await deps.hf.createUploadUrl(contentType);
  const res = await deps.fetchImpl(u.upload_url, { method: "PUT", headers: { ...u.upload_headers, "Content-Type": contentType }, body: new Uint8Array(data) });
  if (!res.ok) throw new Error(`참조 이미지를 올리지 못했습니다 (${res.status})`);
  return u.public_url;
}

export async function briefTotals(briefId: string) {
  const jobs = await db.generationJob.findMany({ where: { briefId } });
  const pendingKrw = jobs.filter((j) => j.status === "ESTIMATED").reduce((a, j) => a + (j.estimateKrw ?? 0), 0);
  return { jobs, pendingKrw };
}

export type BriefWithJobs = Prisma.BriefGetPayload<{ include: { jobs: { include: { assets: true } } } }>;
