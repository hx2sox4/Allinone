"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canEdit, currentContext, currentUser, endSession, hashPassword, startSession, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { approveBrief, createBrief, createVideoFromAsset, uploadToHiggsfield } from "@/lib/briefs";
import { cancelJob, defaultDeps, submitJob } from "@/lib/jobs";

export type FormState = { error?: string } | undefined;

const signupSchema = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요"),
  email: z.string().trim().toLowerCase().email("이메일 형식이 올바르지 않습니다"),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다"),
  aiNotice: z.literal("on", { error: "생성형 AI 이용 고지에 동의해 주세요" }),
});

export async function signup(_prev: FormState, form: FormData): Promise<FormState> {
  const p = signupSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (await db.user.findUnique({ where: { email: p.data.email } })) return { error: "이미 가입된 이메일입니다" };
  const user = await db.user.create({
    data: {
      email: p.data.email,
      name: p.data.name,
      passwordHash: await hashPassword(p.data.password),
      memberships: { create: { role: "OWNER", workspace: { create: { name: `${p.data.name}의 가게` } } } },
    },
  });
  await startSession(user.id);
  redirect("/onboarding");
}

export async function login(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) return { error: "이메일 또는 비밀번호가 맞지 않습니다" };
  await startSession(user.id);
  redirect("/intro"); // 로그인하면 팀 소개부터 보여 준다. 브랜드 기억이 없으면 온보딩으로 넘어간다.
}

export async function logout() {
  await endSession();
  redirect("/login");
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const brandSchema = z.object({
  businessName: z.string().trim().min(1, "가게 이름을 입력해 주세요"),
  industry: z.string().trim().min(1, "업종을 선택해 주세요"),
  websiteUrl: z.string().trim().optional(),
  speechLevel: z.enum(["존댓말", "반말"]),
  voice: z.string().trim().min(1, "말투와 분위기를 적어 주세요"),
  audience: z.string().trim().min(1, "주요 고객을 적어 주세요"),
  offers: z.string().trim().min(1, "대표 상품이나 서비스를 적어 주세요"),
  doSay: z.string().trim(),
  dontSay: z.string().trim(),
});

export async function saveBrand(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!canEdit(c.role)) return { error: "수정 권한이 없습니다" };
  const p = brandSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const palette = form.getAll("palette").map(String).filter((v) => hex.safeParse(v).success);
  const channels = form.getAll("channels").map(String);
  const data = { ...p.data, websiteUrl: p.data.websiteUrl || null, palette, channels };
  await db.brandMemory.upsert({ where: { workspaceId: c.workspace.id }, create: { workspaceId: c.workspace.id, ...data }, update: data });
  await db.workspace.update({ where: { id: c.workspace.id }, data: { name: p.data.businessName } });
  redirect(c.brand ? "/office" : "/intro"); // 처음 저장했을 때만 팀 소개를 보여 준다.
}

/** 브리프 만들기: 시안 작업들로 풀고 견적까지 받는다. 이 단계에서는 비용이 발생하지 않는다. */
export async function createBriefAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!c.brand) redirect("/onboarding");
  if (!canEdit(c.role)) return { error: "생성 권한이 없습니다" };
  try {
    const ids = form.getAll("productIds").map(String);
    const photos = ids.length ? await db.brandAsset.findMany({ where: { id: { in: ids }, workspaceId: c.workspace.id } }) : [];
    const deps = defaultDeps();
    const productUrls: string[] = [];
    for (const p of photos) productUrls.push(await uploadToHiggsfield(await deps.storage.get(p.storageKey), p.contentType, deps));
    const override = String(form.get("modelKey") ?? "");
    await createBrief({
      workspaceId: c.workspace.id,
      userId: c.user.id,
      brand: c.brand,
      what: String(form.get("what") ?? ""),
      channel: String(form.get("channel") ?? ""),
      variants: Number(form.get("variants") ?? 2),
      exactColors: form.get("exactColors") === "on",
      productUrls,
      modelOverride: override || undefined,
    });
  } catch (e) {
    if (e instanceof z.ZodError) return { error: `입력을 확인해 주세요: ${e.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ")}` };
    return { error: e instanceof Error ? e.message : "견적을 받지 못했습니다" };
  }
  revalidatePath("/studio");
  revalidatePath("/office");
}

async function ownBrief(briefId: string) {
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!canEdit(c.role)) throw new Error("권한이 없습니다");
  const brief = await db.brief.findFirst({ where: { id: briefId, workspaceId: c.workspace.id } });
  if (!brief) throw new Error("브리프를 찾을 수 없습니다");
  return brief;
}

export async function approveBriefAction(form: FormData) {
  const brief = await ownBrief(String(form.get("briefId")));
  await approveBrief(brief.id);
  revalidatePath("/studio");
  revalidatePath("/office");
}

export async function cancelBriefAction(form: FormData) {
  const brief = await ownBrief(String(form.get("briefId")));
  const jobs = await db.generationJob.findMany({ where: { briefId: brief.id, status: { in: ["ESTIMATED", "QUEUED"] } } });
  for (const j of jobs) await cancelJob(j.id).catch(() => {});
  revalidatePath("/studio");
  revalidatePath("/office");
}

export async function setApprovalAction(form: FormData) {
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!canEdit(c.role)) throw new Error("권한이 없습니다");
  const approval = z.enum(["PENDING", "APPROVED", "REJECTED"]).parse(form.get("approval"));
  await db.asset.updateMany({ where: { id: String(form.get("assetId")), workspaceId: c.workspace.id }, data: { approval } });
  revalidatePath("/library");
}

/** 고른 시안으로 영상 견적을 받는다. */
export async function makeVideoAction(_prev: FormState, form: FormData): Promise<FormState> {
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!canEdit(c.role)) return { error: "생성 권한이 없습니다" };
  try {
    await createVideoFromAsset({ workspaceId: c.workspace.id, userId: c.user.id, assetId: String(form.get("assetId")), prompt: String(form.get("prompt") ?? ""), modelKey: String(form.get("modelKey") ?? "") || undefined });
  } catch (e) {
    if (e instanceof z.ZodError) return { error: `입력을 확인해 주세요: ${e.issues.map((i) => i.message).join(", ")}` };
    return { error: e instanceof Error ? e.message : "견적을 받지 못했습니다" };
  }
  revalidatePath("/office");
  redirect("/studio");
}

async function ownJob(jobId: string) {
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!canEdit(c.role)) throw new Error("권한이 없습니다");
  const job = await db.generationJob.findFirst({ where: { id: jobId, workspaceId: c.workspace.id } });
  if (!job) throw new Error("작업을 찾을 수 없습니다");
  return job;
}

export async function approveJob(form: FormData) {
  const job = await ownJob(String(form.get("jobId")));
  await submitJob(job.id);
  revalidatePath("/studio");
  revalidatePath("/office");
}

export async function cancelJobAction(form: FormData) {
  const job = await ownJob(String(form.get("jobId")));
  await cancelJob(job.id).catch(() => {});
  revalidatePath("/studio");
  revalidatePath("/office");
}

export async function requireUser() {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
