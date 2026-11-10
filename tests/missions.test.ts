import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { HiggsfieldClient } from "@/lib/higgsfield/client";
import type { LlmClient } from "@/lib/llm/client";
import { advanceMission, answerAsk, eventsAfter, startMission, stopMission, type MissionDeps } from "@/lib/missions";
import type { MEvent } from "@/lib/mission-events";
import { LocalStorage } from "@/lib/storage";
import { startMockHiggsfield, type MockServer } from "../scripts/mock-higgsfield";

let mock: MockServer;
let deps: MissionDeps;
let llmQueue: unknown[] = [];
const llmSeen: string[] = [];
const plan = (over: Record<string, unknown> = {}) => ({ reply: "네, 바로 나눠서 진행하겠습니다.", title: "생강라떼 홍보", copy: true, image: true, video: false, variants: 1, channel: "square", image_prompt_en: "A steaming hot ginger latte in a ceramic mug on a wooden table", video_prompt_en: "Steam rising slowly", news: "11월 한 달 생강라떼 5,500원", ...over });
const copy = { instagram: { caption: "11월 한 달 생강라떼를 준비했습니다.", hashtags: ["생강라떼"] }, image_overlay: ["11월 생강라떼"], sms: "(광고) 온기 생강라떼 5,500원. 무료수신거부 [수신거부번호]" };

async function workspace() {
  const u = await db.user.create({ data: { email: `m${Date.now()}${Math.random()}@example.com`, name: "테스트", passwordHash: "x", memberships: { create: { role: "OWNER", workspace: { create: { name: "온기" } } } } }, include: { memberships: true } });
  const ws = u.memberships[0].workspaceId;
  await db.brandMemory.create({ data: { workspaceId: ws, businessName: "온기", industry: "카페·디저트", speechLevel: "존댓말", voice: "다정하게", audience: "동네 주민", offers: "생강라떼", doSay: "", dontSay: "", channels: [], palette: [] } });
  return { ws, user: u.id };
}
async function run(id: string, until: (evs: MEvent[]) => boolean) {
  for (let i = 0; i < 40; i++) {
    await advanceMission(id, deps);
    const evs = (await eventsAfter(id, 0)).map((e) => e.ev);
    if (until(evs)) return evs;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("임무가 기대한 지점까지 가지 못했습니다: " + JSON.stringify((await eventsAfter(id, 0)).map((e) => e.ev.k)));
}
const kinds = (evs: MEvent[]) => evs.map((e) => e.k);

beforeAll(async () => {
  mock = await startMockHiggsfield({ pollsToComplete: 1 });
  process.env.STORAGE_DRIVER = "local";
  const llm = { json: async (messages: { content: string }[]) => { llmSeen.push(messages[0].content.slice(0, 30)); const data = llmQueue.shift(); if (!data) throw new Error("LLM 응답이 준비되지 않았습니다"); return { data, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, model: "test-model" }; } } as unknown as LlmClient;
  deps = { hf: new HiggsfieldClient({ baseUrl: mock.url, keyId: "id", keySecret: "secret" }), storage: new LocalStorage(mkdtempSync(path.join(tmpdir(), "ilson-mission-"))), fetchImpl: fetch, llm };
});
afterAll(async () => { await mock.close(); await db.$disconnect(); });

describe("사무실 임무", () => {
  it("문구와 이미지: 계획 → 글샘 보고 → 비용 승인 대기 → 승인 후 생성 → 마무리", async () => {
    const { ws, user } = await workspace();
    llmQueue = [plan(), copy];
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "11월 생강라떼 홍보물 만들어줘" });
    const before = mock.submissions.length;
    let evs = await run(m.id, (e) => kinds(e).includes("ask"));
    expect(kinds(evs)).toEqual(["start", "think", "say", "plan", "hire", "hire", "act", "act_done", "copy", "report", "leave", "act", "act_done", "ask"]);
    // 승인 전에는 과금되는 요청이 하나도 나가지 않는다.
    expect(mock.submissions.length).toBe(before);
    // 승인을 기다리는 동안에는 몇 번을 불러도 기록이 늘지 않는다.
    await advanceMission(m.id, deps);
    expect((await eventsAfter(m.id, 0)).length).toBe(evs.length);
    const ask = evs.find((e) => e.k === "ask") as Extract<MEvent, { k: "ask" }>;
    expect(ask.label).toContain("70원");
    // 영어 프롬프트가 생성 모델에 전달된다.
    await answerAsk(m.id, ask.requestId, true, deps);
    expect(mock.submissions.length).toBe(before + 1);
    expect(String((mock.submissions.at(-1)!.body as { prompt?: string }).prompt)).toContain("ginger latte");
    evs = await run(m.id, (e) => kinds(e).includes("end"));
    const tail = kinds(evs).slice(14);
    expect(tail).toEqual(["ask_done", "act", "act_done", "file", "report", "leave", "say", "end"]);
    const done = await db.mission.findUniqueOrThrow({ where: { id: m.id } });
    expect(done.status).toBe("done");
    const file = evs.find((e) => e.k === "file") as Extract<MEvent, { k: "file" }>;
    expect(await db.asset.findUnique({ where: { id: file.file.path } })).toBeTruthy();
    // 순번은 빠짐없이 이어진다 (다시보기의 기준).
    expect((await eventsAfter(m.id, 0)).map((e) => e.seq)).toEqual(evs.map((_, i) => i + 1));
  });

  it("비용을 거절하면 아무것도 제출하지 않고 끝난다", async () => {
    const { ws, user } = await workspace();
    llmQueue = [plan({ copy: false })];
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "생강라떼 사진 만들어줘" });
    const before = mock.submissions.length;
    let evs = await run(m.id, (e) => kinds(e).includes("ask"));
    const ask = evs.find((e) => e.k === "ask") as Extract<MEvent, { k: "ask" }>;
    await answerAsk(m.id, ask.requestId, false, deps);
    evs = await run(m.id, (e) => kinds(e).includes("end"));
    expect(mock.submissions.length).toBe(before);
    expect((evs.find((e) => e.k === "report") as Extract<MEvent, { k: "report" }>).text).toContain("비용은 들지 않았습니다");
    await expect(answerAsk(m.id, ask.requestId, true, deps)).rejects.toThrow();
  });

  it("영상까지: 이미지가 끝난 뒤 영상 비용을 따로 승인받는다", async () => {
    const { ws, user } = await workspace();
    llmQueue = [plan({ copy: false, video: true })];
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "생강라떼 영상 만들어줘" });
    let evs = await run(m.id, (e) => kinds(e).includes("ask"));
    await answerAsk(m.id, (evs.find((e) => e.k === "ask") as Extract<MEvent, { k: "ask" }>).requestId, true, deps);
    evs = await run(m.id, (e) => kinds(e).filter((k) => k === "ask").length === 2);
    const second = evs.filter((e) => e.k === "ask")[1] as Extract<MEvent, { k: "ask" }>;
    expect(second.requestId.startsWith("vid:")).toBe(true);
    expect(second.label).toContain("490원");
    await answerAsk(m.id, second.requestId, true, deps);
    evs = await run(m.id, (e) => kinds(e).includes("end"));
    const files = evs.filter((e) => e.k === "file") as Extract<MEvent, { k: "file" }>[];
    expect(files.map((f) => f.file.ext)).toEqual(["image", "video"]);
  });

  it("할 수 없는 요청은 직원을 부르지 않고 답만 한다", async () => {
    const { ws, user } = await workspace();
    llmQueue = [plan({ copy: false, image: false, reply: "게시 예약은 아직 할 수 없습니다." })];
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "인스타에 예약 게시해줘" });
    const evs = await run(m.id, (e) => kinds(e).includes("end"));
    expect(kinds(evs)).toEqual(["start", "think", "say", "end"]);
  });

  it("LLM이 실패하면 꾸며내지 않고 오류로 끝낸다. 진행 중에는 새 일을 받지 않고, 멈출 수 있다", async () => {
    const { ws, user } = await workspace();
    llmQueue = [];
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "아무거나" });
    await expect(startMission({ workspaceId: ws, userId: user, prompt: "하나 더" })).rejects.toThrow(/진행 중/);
    const evs = await run(m.id, (e) => kinds(e).includes("end"));
    expect(kinds(evs)).toContain("error");
    expect((await db.mission.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("error");
    llmQueue = [plan({ copy: false })];
    const m2 = await startMission({ workspaceId: ws, userId: user, prompt: "사진" });
    await run(m2.id, (e) => kinds(e).includes("ask"));
    await stopMission(m2.id, deps);
    expect((await db.mission.findUniqueOrThrow({ where: { id: m2.id } })).status).toBe("stopped");
    expect(await db.generationJob.count({ where: { workspaceId: ws, status: "ESTIMATED" } })).toBe(0);
  });
});
