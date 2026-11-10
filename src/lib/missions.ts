import type { BrandMemory, Mission, Prisma } from "@prisma/client";
import { db } from "./db";
import { approveBrief, createBrief, createVideoFromAsset } from "./briefs";
import { cancelJob, defaultDeps, isCopyPending, isTerminal, refreshJob, submitJob, type Deps } from "./jobs";
import { LlmClient, llmConfigFromEnv } from "./llm/client";
import { writeCopy } from "./llm/copy";
import { planMission, type MissionPlan } from "./llm/plan";
import { STAFF, type MEvent, type MLogged } from "./mission-events";

export interface MissionDeps extends Deps { llm: LlmClient }
let cachedLlm: LlmClient | undefined;
export function defaultMissionDeps(): MissionDeps {
  cachedLlm ??= new LlmClient(llmConfigFromEnv());
  return { ...defaultDeps(), llm: cachedLlm };
}

interface MState {
  plan?: MissionPlan;
  briefId?: string;
  videoJobId?: string;
  imageAssetIds?: string[];
  did?: string[];
  lastCheck?: number;
  hired?: string[];
}
type Stage = "plan" | "copy" | "image_estimate" | "await_image" | "image_run" | "video_estimate" | "await_video" | "video_run" | "wrap" | "done";

const won = (n: number | null) => (n === null ? "금액 미정" : `${n.toLocaleString("ko-KR")}원`);

/** 기록을 한 줄 남긴다. 순번은 임무 안에서 1씩 늘어난다. */
export async function emit(missionId: string, ev: MEvent): Promise<void> {
  const m = await db.mission.update({ where: { id: missionId }, data: { seq: { increment: 1 } }, select: { seq: true } });
  await db.missionEvent.create({ data: { missionId, seq: m.seq, ev: ev as unknown as Prisma.InputJsonValue } });
}

export async function eventsAfter(missionId: string, after: number): Promise<MLogged[]> {
  const rows = await db.missionEvent.findMany({ where: { missionId, seq: { gt: after } }, orderBy: { seq: "asc" } });
  return rows.map((r) => ({ seq: r.seq, at: r.at.getTime(), ev: r.ev as unknown as MEvent }));
}

export async function startMission(args: { workspaceId: string; userId: string; prompt: string }): Promise<Mission> {
  const prompt = args.prompt.trim().slice(0, 500);
  if (!prompt) throw new Error("무엇을 맡길지 적어 주세요");
  const running = await db.mission.findFirst({ where: { workspaceId: args.workspaceId, status: "working" } });
  if (running) throw new Error("진행 중인 일이 끝난 뒤에 새 일을 맡길 수 있습니다");
  const m = await db.mission.create({ data: { workspaceId: args.workspaceId, createdById: args.userId, prompt, title: prompt.slice(0, 24) } });
  await emit(m.id, { k: "start", text: prompt });
  return m;
}

async function setStage(id: string, stage: Stage, state: MState) {
  await db.mission.update({ where: { id }, data: { stage, state: state as Prisma.InputJsonValue } });
}

async function hire(id: string, st: MState, who: "geulsaem" | "bitna", task: string) {
  if (st.hired?.includes(who)) return;
  st.hired = [...(st.hired ?? []), who];
  await emit(id, { k: "hire", id: who, role: STAFF[who].role, type: who, name: STAFF[who].name, task, prompt: task });
}

async function finish(id: string, ok: boolean, text: string, started: Date, status: "done" | "stopped" | "error" = ok ? "done" : "error") {
  await emit(id, { k: "end", ok, text, ms: Date.now() - started.getTime(), stopped: status === "stopped" });
  await db.mission.update({ where: { id }, data: { status, stage: "done", endedAt: new Date() } });
}

async function lock(id: string, waitMs = 0): Promise<boolean> {
  const until = Date.now() + waitMs;
  for (;;) {
    const now = new Date();
    const got = await db.mission.updateMany({ where: { id, status: "working", busyUntil: { lt: now } }, data: { busyUntil: new Date(now.getTime() + 120_000) } });
    if (got.count) return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}
const unlock = (id: string) => db.mission.updateMany({ where: { id }, data: { busyUntil: new Date(0) } });

/**
 * 임무를 한 걸음 진행한다. 화면이 기록을 물어볼 때마다 불리며, 동시에 한 곳에서만 진행된다.
 * 사람의 승인이나 외부 생성 결과를 기다려야 하면 그 자리에서 멈춘다.
 */
export async function advanceMission(id: string, deps: MissionDeps = defaultMissionDeps()): Promise<void> {
  if (!(await lock(id))) return;
  try {
    for (let guard = 0; guard < 12; guard++) {
      const m = await db.mission.findUniqueOrThrow({ where: { id } });
      if (m.status !== "working") return;
      const again = await step(m, deps);
      if (!again) return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "알 수 없는 오류";
    const m = await db.mission.findUnique({ where: { id } });
    if (m && m.status === "working") {
      await emit(id, { k: "error", message });
      await finish(id, false, `일을 끝내지 못했습니다: ${message}`, m.createdAt);
    }
  } finally {
    await unlock(id);
  }
}

/** true를 돌려주면 바로 다음 걸음을 이어 간다. */
async function step(m: Mission, deps: MissionDeps): Promise<boolean> {
  const id = m.id;
  const st = (m.state ?? {}) as MState;
  const brand = await db.brandMemory.findUnique({ where: { workspaceId: m.workspaceId } });
  if (!brand) throw new Error("브랜드 기억이 없습니다");

  switch (m.stage as Stage) {
    case "plan": {
      await emit(id, { k: "think", who: "chef" });
      const plan = await planMission(m.prompt, brand, deps.llm);
      st.plan = plan;
      await db.mission.update({ where: { id }, data: { title: plan.title.slice(0, 40) } });
      await emit(id, { k: "say", who: "chef", text: plan.reply });
      if (!plan.copy && !plan.image) {
        await setStage(id, "done", st);
        await finish(id, true, plan.reply, m.createdAt);
        return false;
      }
      const items: { text: string; status: "pending" }[] = [];
      if (plan.copy) items.push({ text: "글샘: 문구 초안 쓰기", status: "pending" });
      if (plan.image) items.push({ text: `빛나: 이미지 시안 ${plan.variants}장 만들기`, status: "pending" });
      if (plan.video) items.push({ text: "빛나: 고른 이미지로 5초 영상 만들기", status: "pending" });
      await emit(id, { k: "plan", items });
      if (plan.copy) await hire(id, st, "geulsaem", "인스타그램 캡션, 이미지 위 문구, 문자 광고 초안 쓰기");
      if (plan.image) await hire(id, st, "bitna", plan.video ? `이미지 시안 ${plan.variants}장과 5초 영상 만들기` : `이미지 시안 ${plan.variants}장 만들기`);
      await setStage(id, plan.copy ? "copy" : "image_estimate", st);
      return true;
    }

    case "copy": {
      const plan = st.plan!;
      await emit(id, { k: "act", who: "geulsaem", id: "copy", kind: "write", tool: "DeepSeek", label: "문구 초안 쓰는 중", detail: plan.news });
      const r = await writeCopy({ businessName: brand.businessName, industry: brand.industry, speechLevel: brand.speechLevel, voice: brand.voice, audience: brand.audience, doSay: brand.doSay, dontSay: brand.dontSay, news: plan.news || m.prompt }, deps.llm);
      await emit(id, { k: "act_done", who: "geulsaem", id: "copy", ok: true });
      await emit(id, { k: "copy", who: "geulsaem", draft: r.draft, warnings: r.warnings, model: r.model });
      const warn = r.warnings.length ? ` 확인이 필요한 점 ${r.warnings.length}가지가 있습니다.` : "";
      await emit(id, { k: "report", who: "geulsaem", text: `캡션, 이미지 문구 ${r.draft.image_overlay.length}개, 문자 초안을 썼습니다.${warn}` });
      await emit(id, { k: "leave", who: "geulsaem", ok: true, tokens: r.usage?.total_tokens ?? 0, tools: 1, ms: 0 });
      st.did = [...(st.did ?? []), "copy"];
      await setStage(id, plan.image ? "image_estimate" : "wrap", st);
      return true;
    }

    case "image_estimate": {
      const plan = st.plan!;
      await emit(id, { k: "act", who: "bitna", id: "estimate", kind: "plan", tool: "Higgsfield", label: "이미지 예상 비용 확인 중", detail: plan.image_prompt_en });
      const brief = await createBrief({ workspaceId: m.workspaceId, userId: m.createdById, brand: brand as BrandMemory, what: plan.image_prompt_en, channel: plan.channel, variants: plan.variants, exactColors: false, productUrls: [] }, deps);
      await db.brief.update({ where: { id: brief.id }, data: { missionId: id } });
      st.briefId = brief.id;
      await emit(id, { k: "act_done", who: "bitna", id: "estimate", ok: true });
      await askImage(id, brief.id);
      await setStage(id, "await_image", st);
      return false;
    }

    case "await_image":
    case "await_video":
      return false;

    case "image_run": {
      if (Date.now() - (st.lastCheck ?? 0) < 2500) return false;
      st.lastCheck = Date.now();
      const jobs = await db.generationJob.findMany({ where: { briefId: st.briefId, sourceAssetId: null } });
      for (const j of jobs) if (!isTerminal(j.status)) await refreshJob(j.id, deps);
      const after = await db.generationJob.findMany({ where: { briefId: st.briefId, sourceAssetId: null }, include: { assets: { where: { parentAssetId: null }, orderBy: { createdAt: "asc" } } } });
      if (after.some((j) => !isTerminal(j.status) || isCopyPending(j, j.assets.length))) { await setStage(id, "image_run", st); return false; }
      const assets = after.flatMap((j) => j.assets);
      st.imageAssetIds = assets.map((a) => a.id);
      await emit(id, { k: "act_done", who: "bitna", id: "image", ok: assets.length > 0 });
      for (const a of assets) await emit(id, { k: "file", file: { path: a.id, name: "이미지 시안", ext: "image", size: a.bytes, at: Date.now(), by: "bitna" }, isNew: true });
      const failed = after.filter((j) => j.status !== "COMPLETED");
      if (assets.length === 0) {
        const why = failed[0]?.status === "NSFW" ? "심의에서 중단됐습니다" : failed[0]?.error || "생성에 실패했습니다";
        await emit(id, { k: "report", who: "bitna", text: `이미지를 만들지 못했습니다: ${why}. 실패한 요청은 과금되지 않습니다.` });
        await emit(id, { k: "leave", who: "bitna", ok: false, tokens: 0, tools: 1, ms: 0 });
        await setStage(id, "wrap", st);
        return true;
      }
      st.did = [...(st.did ?? []), "image"];
      await emit(id, { k: "report", who: "bitna", text: `이미지 시안 ${assets.length}장을 만들었습니다.${failed.length ? ` ${failed.length}건은 실패했습니다.` : ""}` });
      if (st.plan!.video) { await setStage(id, "video_estimate", st); return true; }
      await emit(id, { k: "leave", who: "bitna", ok: true, tokens: 0, tools: 1, ms: 0 });
      await setStage(id, "wrap", st);
      return true;
    }

    case "video_estimate": {
      const plan = st.plan!;
      await emit(id, { k: "act", who: "bitna", id: "vestimate", kind: "plan", tool: "Higgsfield", label: "영상 예상 비용 확인 중", detail: plan.video_prompt_en });
      const job = await createVideoFromAsset({ workspaceId: m.workspaceId, userId: m.createdById, assetId: st.imageAssetIds![0], prompt: plan.video_prompt_en || "Slow gentle camera push-in" }, deps);
      st.videoJobId = job.id;
      await emit(id, { k: "act_done", who: "bitna", id: "vestimate", ok: true });
      await emit(id, { k: "ask", who: "bitna", requestId: `vid:${job.id}`, tool: "Higgsfield", label: `5초 영상 1건 만들기 · 예상 ${won(job.estimateKrw)}`, detail: job.estimateUsd ? `견적 ${job.estimateUsd}달러. 원화는 운영자가 정한 환율로 계산한 값입니다.` : (job.estimateNote ?? ""), full: true });
      await setStage(id, "await_video", st);
      return false;
    }

    case "video_run": {
      if (Date.now() - (st.lastCheck ?? 0) < 4000) return false;
      st.lastCheck = Date.now();
      const done = await refreshJob(st.videoJobId!, deps);
      const job = await db.generationJob.findUniqueOrThrow({ where: { id: st.videoJobId! }, include: { assets: true } });
      if (!done || isCopyPending(job, job.assets.length)) { await setStage(id, "video_run", st); return false; }
      const ok = job.status === "COMPLETED" && job.assets.length > 0;
      await emit(id, { k: "act_done", who: "bitna", id: "video", ok });
      for (const a of job.assets) await emit(id, { k: "file", file: { path: a.id, name: "5초 영상", ext: "video", size: a.bytes, at: Date.now(), by: "bitna" }, isNew: true });
      if (ok) st.did = [...(st.did ?? []), "video"];
      await emit(id, { k: "report", who: "bitna", text: ok ? "5초 영상을 만들었습니다." : `영상을 만들지 못했습니다${job.status === "NSFW" ? ": 심의에서 중단됐습니다" : ""}. 실패한 요청은 과금되지 않습니다.` });
      await emit(id, { k: "leave", who: "bitna", ok, tokens: 0, tools: 1, ms: 0 });
      await setStage(id, "wrap", st);
      return true;
    }

    case "wrap": {
      const did = st.did ?? [];
      const names = [did.includes("copy") ? "문구 초안" : "", did.includes("image") ? `이미지 ${st.imageAssetIds?.length ?? 0}장` : "", did.includes("video") ? "5초 영상" : ""].filter(Boolean);
      const text = names.length ? `${names.join(", ")}을 준비했습니다. 프린터를 누르면 결과물을 볼 수 있습니다.` : "이번에는 만든 결과물이 없습니다.";
      await emit(id, { k: "say", who: "chef", text });
      await finish(id, names.length > 0, text, m.createdAt, "done");
      return false;
    }
  }
  return false;
}

async function askImage(id: string, briefId: string) {
  const jobs = await db.generationJob.findMany({ where: { briefId, status: "ESTIMATED" } });
  const krw = jobs.every((j) => j.estimateKrw !== null) ? jobs.reduce((a, j) => a + (j.estimateKrw ?? 0), 0) : null;
  const usd = jobs.reduce((a, j) => a + Number(j.estimateUsd ?? 0), 0);
  await emit(id, { k: "ask", who: "bitna", requestId: `img:${briefId}`, tool: "Higgsfield", label: `이미지 ${jobs.length}건 만들기 · 예상 ${won(krw)}`, detail: krw !== null ? `견적 ${usd.toFixed(3)}달러. 원화는 운영자가 정한 환율로 계산한 값입니다.` : (jobs[0]?.estimateNote ?? ""), full: true });
}

/** 비용 승인 또는 거절. 승인해야만 과금되는 요청이 나간다. */
export async function answerAsk(id: string, requestId: string, allow: boolean, deps: MissionDeps = defaultMissionDeps()): Promise<void> {
  if (!(await lock(id, 8000))) throw new Error("잠시 뒤 다시 눌러 주세요");
  try {
    const m = await db.mission.findUniqueOrThrow({ where: { id } });
    const st = (m.state ?? {}) as MState;
    if (m.stage === "await_image" && requestId === `img:${st.briefId}`) {
      await emit(id, { k: "ask_done", requestId, allow });
      if (!allow) {
        const jobs = await db.generationJob.findMany({ where: { briefId: st.briefId, status: "ESTIMATED" } });
        for (const j of jobs) await cancelJob(j.id, deps);
        await emit(id, { k: "report", who: "bitna", text: "이미지는 만들지 않기로 했습니다. 비용은 들지 않았습니다." });
        await emit(id, { k: "leave", who: "bitna", ok: true, tokens: 0, tools: 0, ms: 0 });
        await setStage(id, "wrap", st);
        return;
      }
      await approveBrief(st.briefId!, deps);
      const stuck = await db.generationJob.findFirst({ where: { briefId: st.briefId, status: "ESTIMATED", error: { not: null } } });
      if (stuck) {
        await emit(id, { k: "say", who: "chef", text: stuck.error! });
        await askImage(id, st.briefId!);
        return;
      }
      await emit(id, { k: "act", who: "bitna", id: "image", kind: "other", tool: "Higgsfield", label: "이미지 만드는 중", detail: st.plan?.image_prompt_en ?? "" });
      await setStage(id, "image_run", { ...st, lastCheck: 0 });
      return;
    }
    if (m.stage === "await_video" && requestId === `vid:${st.videoJobId}`) {
      await emit(id, { k: "ask_done", requestId, allow });
      if (!allow) {
        await cancelJob(st.videoJobId!, deps);
        await emit(id, { k: "report", who: "bitna", text: "영상은 만들지 않기로 했습니다. 영상 비용은 들지 않았습니다." });
        await emit(id, { k: "leave", who: "bitna", ok: true, tokens: 0, tools: 0, ms: 0 });
        await setStage(id, "wrap", st);
        return;
      }
      const job = await submitJob(st.videoJobId!, deps);
      if (job.status === "ESTIMATED" && job.error) {
        await emit(id, { k: "say", who: "chef", text: job.error });
        await emit(id, { k: "ask", who: "bitna", requestId, tool: "Higgsfield", label: `5초 영상 1건 만들기 · 예상 ${won(job.estimateKrw)}`, detail: job.error, full: true });
        return;
      }
      await emit(id, { k: "act", who: "bitna", id: "video", kind: "other", tool: "Higgsfield", label: "영상 만드는 중", detail: st.plan?.video_prompt_en ?? "" });
      await setStage(id, "video_run", { ...st, lastCheck: 0 });
      return;
    }
    throw new Error("이미 처리된 요청입니다");
  } finally {
    await unlock(id);
  }
}

/** 임무 중단. 아직 제출하지 않았거나 대기 중인 생성은 취소한다. 이미 처리 중인 생성은 취소되지 않는다. */
export async function stopMission(id: string, deps: MissionDeps = defaultMissionDeps()): Promise<void> {
  if (!(await lock(id, 8000))) return;
  try {
    const m = await db.mission.findUniqueOrThrow({ where: { id } });
    const st = (m.state ?? {}) as MState;
    const jobs = await db.generationJob.findMany({ where: { OR: [{ briefId: st.briefId ?? "-" }, { id: st.videoJobId ?? "-" }], status: { in: ["ESTIMATED", "QUEUED"] } } });
    for (const j of jobs) await cancelJob(j.id, deps).catch(() => {});
    await finish(id, false, "일을 멈췄습니다.", m.createdAt, "stopped");
  } finally {
    await unlock(id);
  }
}
