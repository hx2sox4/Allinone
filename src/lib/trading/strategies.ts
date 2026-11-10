// 전략 연구원이 검증하는 규칙들. 모두 정해진 규칙이며 LLM이 고르거나 바꾸지 않는다.
// 신호는 i번째 봉이 "마감한 뒤" 판단하고, 진입은 다음 봉 시가(백테스트) 또는 현재가(모의매매)로 한다.
import type { Candle } from "@/lib/market/hyperliquid";
import { atr, ema, priorHigh, priorLow, rsi } from "./indicators";

export type Side = "long" | "short";
export interface Signal { side: Side; stop: number; targetR: number }

export interface Series { o: number[]; h: number[]; l: number[]; c: number[]; ema20: number[]; ema50: number[]; ema200: number[]; rsi2: number[]; rsi14: number[]; atr14: number[] }

export function series(cs: Candle[]): Series {
  const c = cs.map((k) => k.c), h = cs.map((k) => k.h), l = cs.map((k) => k.l), o = cs.map((k) => k.o);
  return { o, h, l, c, ema20: ema(c, 20), ema50: ema(c, 50), ema200: ema(c, 200), rsi2: rsi(c, 2), rsi14: rsi(c, 14), atr14: atr(h, l, c, 14) };
}

export interface Strategy {
  key: string;
  name: string;
  rule: string;
  /** 진입 후 이 봉 수가 지나면 종가로 청산 */
  maxBars: number;
  signal(s: Series, i: number): Signal | null;
}

const ok = (...v: number[]) => v.every((x) => Number.isFinite(x));

export const STRATEGIES: Strategy[] = [
  {
    key: "trend_pullback",
    name: "추세 눌림 재진입",
    rule: "EMA50이 EMA200 위(아래)일 때, 직전 봉 종가가 EMA20 아래(위)였다가 이번 봉이 EMA20 위(아래)로 마감하면 진입. 손절은 최근 10봉 저점(고점) ± 0.3 ATR, 목표 2R, 최대 30봉 보유.",
    maxBars: 30,
    signal(s, i) {
      if (i < 1 || !ok(s.ema20[i], s.ema20[i - 1], s.ema50[i], s.ema200[i], s.atr14[i])) return null;
      const up = s.ema50[i] > s.ema200[i];
      if (up && s.c[i - 1] < s.ema20[i - 1] && s.c[i] > s.ema20[i]) return { side: "long", stop: priorLow(s.l, i + 1, 10) - 0.3 * s.atr14[i], targetR: 2 };
      if (!up && s.c[i - 1] > s.ema20[i - 1] && s.c[i] < s.ema20[i]) return { side: "short", stop: priorHigh(s.h, i + 1, 10) + 0.3 * s.atr14[i], targetR: 2 };
      return null;
    },
  },
  {
    key: "breakout",
    name: "20봉 돌파",
    rule: "EMA50이 EMA200 위(아래)일 때 종가가 직전 20봉 최고가(최저가)를 넘으면 진입. 손절 2 ATR, 목표 2R, 최대 40봉 보유.",
    maxBars: 40,
    signal(s, i) {
      if (!ok(s.ema50[i], s.ema200[i], s.atr14[i])) return null;
      const hi = priorHigh(s.h, i, 20), lo = priorLow(s.l, i, 20);
      if (!ok(hi, lo)) return null;
      if (s.ema50[i] > s.ema200[i] && s.c[i] > hi) return { side: "long", stop: s.c[i] - 2 * s.atr14[i], targetR: 2 };
      if (s.ema50[i] < s.ema200[i] && s.c[i] < lo) return { side: "short", stop: s.c[i] + 2 * s.atr14[i], targetR: 2 };
      return null;
    },
  },
  {
    key: "rsi2_reversion",
    name: "RSI(2) 되돌림",
    rule: "종가가 EMA200 위이고 RSI(2)가 10 아래면 롱, EMA200 아래이고 RSI(2)가 90 위면 숏. 손절 1.5 ATR, 목표 1R, 최대 10봉 보유.",
    maxBars: 10,
    signal(s, i) {
      if (!ok(s.ema200[i], s.rsi2[i], s.atr14[i])) return null;
      if (s.c[i] > s.ema200[i] && s.rsi2[i] < 10) return { side: "long", stop: s.c[i] - 1.5 * s.atr14[i], targetR: 1 };
      if (s.c[i] < s.ema200[i] && s.rsi2[i] > 90) return { side: "short", stop: s.c[i] + 1.5 * s.atr14[i], targetR: 1 };
      return null;
    },
  },
];

export const getStrategy = (key: string) => STRATEGIES.find((s) => s.key === key);
