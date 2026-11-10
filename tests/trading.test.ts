import { describe, expect, it } from "vitest";
import { atr, ema, rsi, sma } from "@/lib/trading/indicators";
import { backtest, judge, PROPR_COSTS, stats, tradeR } from "@/lib/trading/backtest";
import { checkRisk } from "@/lib/trading/risk";
import { parseRss, recentHeadlines } from "@/lib/trading/news";
import { HyperliquidMarket } from "@/lib/market/hyperliquid";
import { getStrategy, STRATEGIES } from "@/lib/trading/strategies";
import { synth } from "./helpers/candles";

const END = Date.UTC(2026, 10, 10);

describe("지표", () => {
  it("SMA, EMA, RSI, ATR 기본값", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([NaN, 1.5, 2.5, 3.5]);
    const e = ema([1, 2, 3, 4, 5], 3);
    expect(e[2]).toBe(2);
    expect(e[3]).toBeCloseTo(3);
    expect(rsi([1, 2, 3, 4, 5, 6], 3)[5]).toBe(100);
    expect(rsi([6, 5, 4, 3, 2, 1], 3)[5]).toBe(0);
    const a = atr([2, 2, 2], [1, 1, 1], [1.5, 1.5, 1.5], 2);
    expect(a[1]).toBeCloseTo(1);
  });
});

describe("백테스트", () => {
  it("수수료는 R을 깎는다: 1R 목표 거래는 수수료 뒤 1R보다 작다", () => {
    const r = tradeR("long", 100, 99, 101, "target", PROPR_COSTS);
    expect(r).toBeLessThan(1);
    expect(r).toBeCloseTo((1 - 100 * (PROPR_COSTS.feeTaker + PROPR_COSTS.slippage) - 101 * PROPR_COSTS.feeMaker) / 1, 6);
    expect(tradeR("short", 100, 101, 101, "stop", PROPR_COSTS)).toBeLessThan(-1);
  });

  it("추세장에서는 추세 전략이 통과하고, 횡보장에서는 모두 탈락한다", () => {
    const trend = synth(3000, "4h", END, { drift: 0.0005 });
    const tp = backtest(trend, getStrategy("trend_pullback")!);
    expect(tp.passed).toBe(true);
    expect(tp.verify.trades).toBeGreaterThanOrEqual(10);
    const flat = synth(3000, "4h", END, { drift: 0, wave: 0.05 });
    for (const s of STRATEGIES) expect(backtest(flat, s).passed).toBe(false);
  });

  it("한 번에 한 포지션: 거래 시간이 겹치지 않는다", () => {
    const r = backtest(synth(2000, "4h", END), getStrategy("breakout")!);
    for (let i = 1; i < r.trades.length; i++) expect(r.trades[i].entryAt).toBeGreaterThan(r.trades[i - 1].exitAt);
  });

  it("판정 기준", () => {
    const s = (trades: number, avgR: number) => ({ ...stats([]), trades, avgR });
    expect(judge(s(30, 0.1), s(5, 0.5)).passed).toBe(false);
    expect(judge(s(30, -0.1), s(20, 0.5)).passed).toBe(false);
    expect(judge(s(30, 0.1), s(20, -0.01)).passed).toBe(false);
    expect(judge(s(30, 0.1), s(20, 0.2)).passed).toBe(true);
  });
});

describe("리스크", () => {
  const base = { balance: 10000, riskPct: 0.5, maxLeverage: 1, dailyStopPct: 1.5, todayPnl: 0, hasOpen: false, side: "long" as const, entry: 100_000, stop: 99_000, newsRiskOff: false };
  it("1회 위험으로 수량을 정한다", () => {
    const d = checkRisk(base);
    expect(d.ok && d.qty).toBe(0.05);
  });
  it("레버리지 상한을 넘으면 수량을 줄인다", () => {
    const d = checkRisk({ ...base, stop: 99_900 });
    expect(d.ok && d.notional).toBeLessThanOrEqual(10000);
  });
  it("막는 경우: 중복, 뉴스 위험 회피, 일일 한도, 손절 방향 오류", () => {
    expect(checkRisk({ ...base, hasOpen: true }).ok).toBe(false);
    expect(checkRisk({ ...base, newsRiskOff: true }).ok).toBe(false);
    expect(checkRisk({ ...base, todayPnl: -150 }).ok).toBe(false);
    expect(checkRisk({ ...base, stop: 101_000 }).ok).toBe(false);
  });
});

describe("뉴스", () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Bitcoin exchange hacked, withdrawals halted]]></title><link>https://ex.com/a</link><pubDate>Tue, 10 Nov 2026 09:00:00 GMT</pubDate></item>
    <item><title>Solana upgrade ships</title><link>https://ex.com/b</link><pubDate>Tue, 10 Nov 2026 08:00:00 GMT</pubDate></item>
    <item><title>Old BTC story</title><link>https://ex.com/c</link><pubDate>Fri, 06 Nov 2026 08:00:00 GMT</pubDate></item>
  </channel></rss>`;
  it("RSS 제목·링크·시각을 읽는다", () => {
    const items = parseRss(xml, "ex.com");
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ title: "Bitcoin exchange hacked, withdrawals halted", link: "https://ex.com/a" });
  });
  it("키워드와 24시간으로 거르고, 실패한 피드는 따로 알려 준다", async () => {
    const f = (async (url: string) => (url.includes("bad") ? new Response("x", { status: 500 }) : new Response(xml))) as unknown as typeof fetch;
    const r = await recentHeadlines(["bitcoin", "btc"], { feeds: ["https://ok.test/rss", "https://bad.test/rss"], fetchImpl: f, now: Date.UTC(2026, 10, 10, 10) });
    expect(r.items.map((h) => h.title)).toEqual(["Bitcoin exchange hacked, withdrawals halted"]);
    expect(r.failed).toEqual(["https://bad.test/rss"]);
  });
});

describe("Hyperliquid 시세", () => {
  it("candleSnapshot 형식으로 요청하고 문자열 숫자를 바꾼다", async () => {
    const bodies: unknown[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json([{ t: 0, T: 59_999, s: "BTC", i: "1m", o: "1", h: "2", l: "0.5", c: "1.5", v: "10", n: 3 }]);
    }) as unknown as typeof fetch;
    const cs = await new HyperliquidMarket(f, "https://hl.test/info").candles("BTC", "1m", 10, 600_000);
    expect(bodies[0]).toEqual({ type: "candleSnapshot", req: { coin: "BTC", interval: "1m", startTime: 0, endTime: 600_000 } });
    expect(cs[0]).toEqual({ t: 0, T: 59_999, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 });
  });
});
