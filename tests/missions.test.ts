import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { LlmClient } from "@/lib/llm/client";
import type { Candle } from "@/lib/market/hyperliquid";
import { advanceMission, eventsAfter, startMission, type MissionDeps } from "@/lib/missions";
import type { DeskEvent, MEvent } from "@/lib/mission-events";
import { accountSummary } from "@/lib/trading/account-view";
import { series, getStrategy } from "@/lib/trading/strategies";
import { FakeMarket, synth } from "./helpers/candles";

const END = Date.UTC(2026, 10, 10);

function llmFrom(queue: unknown[]) {
  return { json: async () => { const data = queue.shift(); if (!data) throw new Error("LLM 응답 없음"); return { data, usage: null, model: "test-model" }; } } as unknown as LlmClient;
}
async function workspace() {
  const u = await db.user.create({ data: { email: `t${Date.now()}${Math.random()}@example.com`, name: "테스트", passwordHash: "x", memberships: { create: { role: "OWNER", workspace: { create: { name: "데스크" } } } } }, include: { memberships: true } });
  return { ws: u.memberships[0].workspaceId, user: u.id };
}
async function runAll(id: string, deps: MissionDeps) {
  for (let i = 0; i < 10; i++) {
    await advanceMission(id, deps);
    const m = await db.mission.findUniqueOrThrow({ where: { id } });
    if (m.status !== "working") break;
  }
  return (await eventsAfter(id, 0)).map((e) => e.ev);
}
const find = <K extends DeskEvent["k"]>(evs: MEvent[], k: K) => evs.find((e) => e.k === k) as Extract<DeskEvent, { k: K }>;
const plan = (mode: string) => ({ reply: "네, 확인하겠습니다.", title: "BTC 점검", coin: "BTC", interval: "4h", mode });
/** 기준 시각 1시간 전 헤드라인 하나를 주는 가짜 RSS */
const rssAt = (at: number) => (async () => new Response(`<rss><channel><item><title>Bitcoin ETF flows steady</title><link>https://ex.com/a</link><pubDate>${new Date(at - 3_600_000).toUTCString()}</pubDate></item></channel></rss>`)) as unknown as typeof fetch;
const rssFetch = rssAt(END);

/** 추세 눌림 신호가 마지막 봉에서 나는 지점까지 자른 4시간봉 */
function withSignalAtEnd(): Candle[] {
  const all = synth(3400, "4h", END, { drift: 0.0005 });
  const s = series(all);
  const st = getStrategy("trend_pullback")!;
  for (let i = all.length - 1; i > 3000; i--) if (st.signal(s, i)?.side === "long") return all.slice(0, i + 1);
  throw new Error("신호 지점을 찾지 못함");
}
const oneMin = (t: number, c: number, h = c, l = c): Candle => ({ t, T: t + 59_999, o: c, h, l, c, v: 1 });

afterAll(async () => { await db.$disconnect(); });

describe("트레이딩 데스크 임무", () => {
  it("횡보장: 전략이 모두 탈락하면 주문하지 않고, 이유를 보고서에 남긴다", async () => {
    const { ws, user } = await workspace();
    const market = new FakeMarket({ "4h": synth(3000, "4h", END, { drift: 0, wave: 0.05 }), "1m": [oneMin(END - 60_000, 50_000)] });
    const deps: MissionDeps = { llm: llmFrom([plan("trade"), { stance: "neutral", summary: "특별한 위험 없음(1)", used: [1] }]), market, fetchImpl: rssFetch, now: () => END };
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "비트코인 4시간봉 보고 맞으면 사줘" });
    const evs = await runAll(m.id, deps);
    expect(evs.at(-1)).toMatchObject({ k: "end", ok: true });
    expect(find(evs, "backtest").chosen).toBeNull();
    expect(find(evs, "backtest").rows.every((r) => !r.passed)).toBe(true);
    expect(find(evs, "news").items).toHaveLength(1);
    expect(find(evs, "timing").signal).toBeNull();
    expect(find(evs, "order").ok).toBe(false);
    expect(await db.paperTrade.count({ where: { workspaceId: ws } })).toBe(0);
  });

  it("신호가 나면 리스크를 통과한 수량으로 모의 주문하고, 이후 1분봉으로 목표 청산한다", async () => {
    const { ws, user } = await workspace();
    const cs = withSignalAtEnd();
    const last = cs[cs.length - 1];
    const now = last.T + 1 + 60_000;
    const price = last.c;
    const market = new FakeMarket({ "4h": cs, "1m": [oneMin(last.T + 1, price)] });
    const deps: MissionDeps = { llm: llmFrom([plan("trade"), { stance: "neutral", summary: "중립(1)", used: [1] }]), market, fetchImpl: rssAt(now), now: () => now };
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "BTC 4h 모의매매" });
    const evs = await runAll(m.id, deps);
    expect(find(evs, "backtest").chosen).not.toBeNull();
    const timing = find(evs, "timing");
    const order = find(evs, "order");
    expect(find(evs, "backtest").chosen).toBe("trend_pullback");
    expect(timing.signal?.side).toBe("long");
    expect(order.ok).toBe(true);
    const t = await db.paperTrade.findFirstOrThrow({ where: { workspaceId: ws } });
    // 1회 위험 0.5% = 50 USDC 이하, 레버리지 1배 이하
    expect((t.entry - t.stop) * t.qty).toBeLessThanOrEqual(50.01);
    expect(t.entry * t.qty).toBeLessThanOrEqual(10000);
    // 같은 종목에 다시 맡기면 중복으로 막힌다
    const m2 = await startMission({ workspaceId: ws, userId: user, prompt: "한 번 더" });
    const evs2 = await runAll(m2.id, { ...deps, llm: llmFrom([plan("trade"), { stance: "neutral", summary: "", used: [] }]) });
    expect(find(evs2, "order").text).toContain("이미 열린 포지션");
    // 다음 1분봉이 목표가를 넘으면 목표 청산
    market.data["1m"] = [oneMin(now, price, t.target * 1.001, price * 0.9999)];
    const a = await accountSummary(ws, market, now + 120_000);
    expect(a.open).toHaveLength(0);
    expect(a.closed[0]).toMatchObject({ exitReason: "target" });
    expect(a.closed[0].pnl!).toBeGreaterThan(0);
    expect(a.balance).toBeCloseTo(10000 + a.closed[0].pnl!, 6);
  });

  it("뉴스 위험 회피면 신호가 있어도 주문하지 않는다", async () => {
    const { ws, user } = await workspace();
    const cs = withSignalAtEnd();
    const last = cs[cs.length - 1];
    const now = last.T + 1 + 60_000;
    const market = new FakeMarket({ "4h": cs, "1m": [oneMin(last.T + 1, last.c)] });
    const deps: MissionDeps = { llm: llmFrom([plan("trade"), { stance: "risk_off", summary: "거래소 해킹(1)", used: [1] }]), market, fetchImpl: rssAt(now), now: () => now };
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "BTC" });
    const evs = await runAll(m.id, deps);
    expect(find(evs, "news").stance).toBe("risk_off");
    expect(find(evs, "timing").signal).not.toBeNull();
    expect(find(evs, "order").text).toContain("뉴스");
    expect(await db.paperTrade.count({ where: { workspaceId: ws } })).toBe(0);
  });

  it("분석만 요청하면 다온을 부르지 않고 주문하지 않는다. 트레이딩과 무관한 요청은 바로 끝낸다", async () => {
    const { ws, user } = await workspace();
    const market = new FakeMarket({ "4h": synth(3000, "4h", END), "1m": [oneMin(END - 60_000, 50_000)] });
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "BTC 분석만" });
    const evs = await runAll(m.id, { llm: llmFrom([plan("analyze"), { stance: "neutral", summary: "", used: [] }]), market, fetchImpl: rssFetch, now: () => END });
    expect(evs.some((e) => e.k === "hire" && e.id === "daon")).toBe(false);
    expect(evs.some((e) => e.k === "order")).toBe(false);
    const m2 = await startMission({ workspaceId: ws, userId: user, prompt: "오늘 점심 뭐 먹지" });
    const evs2 = await runAll(m2.id, { llm: llmFrom([{ ...plan("none"), reply: "트레이딩 요청만 받을 수 있습니다." }]), market, fetchImpl: rssFetch, now: () => END });
    expect(evs2.map((e) => e.k)).toEqual(["start", "think", "say", "end"]);
  });

  it("뉴스를 못 가져와도 멈추지 않고, 뉴스는 판단에 쓰지 않았다고 밝힌다", async () => {
    const { ws, user } = await workspace();
    const market = new FakeMarket({ "4h": synth(3000, "4h", END), "1m": [oneMin(END - 60_000, 50_000)] });
    const fail = (async () => { throw new Error("blocked"); }) as unknown as typeof fetch;
    const m = await startMission({ workspaceId: ws, userId: user, prompt: "BTC 분석" });
    const evs = await runAll(m.id, { llm: llmFrom([plan("analyze")]), market, fetchImpl: fail, now: () => END });
    const news = find(evs, "news");
    expect(news.stance).toBeNull();
    expect(news.summary).toContain("가져오지 못했습니다");
    expect(evs.at(-1)).toMatchObject({ k: "end", ok: true });
  });
});
