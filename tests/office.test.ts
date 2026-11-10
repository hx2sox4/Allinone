import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { officeState } from "@/lib/office";
import { TEAM } from "@/lib/team";

let ws: string;
let user: string;
const job = (status: "ESTIMATED" | "QUEUED" | "IN_PROGRESS" | "COMPLETED" | "NSFW", modelKey = "z-image-turbo", estimateKrw = 70) =>
  db.generationJob.create({ data: { workspaceId: ws, createdById: user, modelKey, input: { prompt: "p" }, status, estimateKrw } });
const bitna = async () => (await officeState(ws)).members.find((m) => m.key === "bitna")!;

beforeAll(async () => {
  const u = await db.user.create({ data: { email: `office${Date.now()}@example.com`, name: "테스트", passwordHash: "x", memberships: { create: { role: "OWNER", workspace: { create: { name: "사무실 테스트" } } } } }, include: { memberships: true } });
  user = u.id;
  ws = u.memberships[0].workspaceId;
});
afterAll(() => db.$disconnect());

describe("사무실 상태", () => {
  it("직원은 다섯 명이고 이름이 겹치지 않는다", () => {
    expect(TEAM.length).toBe(5);
    expect(new Set(TEAM.map((m) => m.name)).size).toBe(5);
  });
  it("작업이 없으면 빛나는 대기하고, 아직 일하지 않는 직원은 '곧 합류'로만 표시한다", async () => {
    const s = await officeState(ws);
    expect(s.members.find((m) => m.key === "bitna")).toMatchObject({ mood: "idle", bubble: "무엇을 만들까요?" });
    for (const m of s.members.filter((m) => m.key !== "bitna")) expect(m).toMatchObject({ mood: "soon", bubble: "곧 합류해요" });
    expect(s).toMatchObject({ running: 0, awaitingApproval: 0, finishedAssets: 0 });
  });
  it("견적만 받은 작업이 있으면 승인 대기와 합계 금액을 보여 준다", async () => {
    await job("ESTIMATED", "z-image-turbo", 70);
    await job("ESTIMATED", "kling-2-5-turbo-i2v", 490);
    expect(await bitna()).toMatchObject({ mood: "waiting", bubble: "승인 기다리는 중 · 560원" });
    expect((await officeState(ws)).awaitingApproval).toBe(2);
  });
  it("진행 중인 작업이 있으면 일하는 중이 승인 대기보다 먼저다", async () => {
    await job("IN_PROGRESS", "kling-2-5-turbo-i2v");
    expect(await bitna()).toMatchObject({ mood: "working", bubble: "영상 만드는 중" });
    await job("QUEUED");
    const b = await bitna();
    expect(b.mood).toBe("working");
    expect(b.bubble).toMatch(/외 1건 만드는 중/);
  });
  it("다른 워크스페이스의 작업은 보이지 않는다", async () => {
    const other = await db.workspace.create({ data: { name: "남의 가게" } });
    expect(await officeState(other.id)).toMatchObject({ running: 0, awaitingApproval: 0 });
  });
});
