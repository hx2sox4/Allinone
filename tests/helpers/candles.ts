import type { Candle, Interval, MarketData } from "@/lib/market/hyperliquid";
import { INTERVAL_MS } from "@/lib/market/hyperliquid";

/** 시험용 가짜 시세. 추세 + 사인파 + 고정 시드 잡음. 끝 시각 기준으로 거꾸로 만든다. */
export function synth(bars: number, interval: Interval, endMs: number, opts: { drift?: number; wave?: number; period?: number; start?: number; seed?: number } = {}): Candle[] {
  const step = INTERVAL_MS[interval];
  const { drift = 0.002, wave = 0.03, period = 40, start = 50_000 } = opts;
  let seed = opts.seed ?? 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const first = Math.floor(endMs / step) * step - step * bars;
  const out: Candle[] = [];
  let prev = start;
  for (let i = 0; i < bars; i++) {
    const base = start * Math.exp(drift * i) * (1 + wave * Math.sin((2 * Math.PI * i) / period));
    const c = base * (1 + 0.002 * rnd());
    const o = prev;
    const h = Math.max(o, c) * (1 + 0.001 + 0.001 * Math.abs(rnd()));
    const l = Math.min(o, c) * (1 - 0.001 - 0.001 * Math.abs(rnd()));
    out.push({ t: first + i * step, T: first + (i + 1) * step - 1, o, h, l, c, v: 1 });
    prev = c;
  }
  return out;
}

/** 시간축별로 정해 둔 시세를 돌려주는 가짜 시장 */
export class FakeMarket implements MarketData {
  calls: { coin: string; interval: Interval; bars: number }[] = [];
  constructor(public data: Partial<Record<Interval, Candle[]>>) {}
  async candles(coin: string, interval: Interval, bars: number, endMs = Date.now()) {
    this.calls.push({ coin, interval, bars });
    const cs = this.data[interval] ?? [];
    return cs.filter((c) => c.t < endMs).slice(-bars);
  }
}
