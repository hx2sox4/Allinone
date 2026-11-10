// Hyperliquid 공개 시세(키 없음). Propr가 Hyperliquid 무기한을 거래하므로 같은 가격이다.
// 요청 형식은 사용자 PC의 propr_bot/data.py(실제로 돌아가는 코드)와 같다:
//   POST https://api.hyperliquid.xyz/info {"type":"candleSnapshot","req":{coin,interval,startTime,endTime}}
//   응답 행: t(시작 ms), T(끝 ms), o/h/l/c/v(문자열). 한 번에 최근 5000개까지만 준다(같은 파일의 주석).
// 이 저장소의 클라우드 환경에서는 이 주소가 막혀 있어 실제 호출은 사용자 PC에서만 확인할 수 있다.

export interface Candle { t: number; T: number; o: number; h: number; l: number; c: number; v: number }

export const INTERVAL_MS = { "1m": 60_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 } as const;
export type Interval = keyof typeof INTERVAL_MS;
export const TRADE_INTERVALS: Interval[] = ["15m", "1h", "4h", "1d"];

/** 매매 대상. xyz:로 시작하는 것은 Hyperliquid HIP-3 거래소 종목(사용자 PC의 alert5.py가 같은 이름으로 시세를 받는다). */
export const COINS: Record<string, { label: string; news: string[] }> = {
  BTC: { label: "비트코인", news: ["bitcoin", "btc"] },
  ETH: { label: "이더리움", news: ["ethereum", "ether", "eth"] },
  SOL: { label: "솔라나", news: ["solana", "sol"] },
  "xyz:XYZ100": { label: "나스닥100 (XYZ100)", news: ["nasdaq", "fed", "tech stocks", "stocks"] },
};

export interface MarketData {
  candles(coin: string, interval: Interval, bars: number, endMs?: number): Promise<Candle[]>;
}

export class HyperliquidMarket implements MarketData {
  constructor(private fetchImpl: typeof fetch = fetch, private url = process.env.HL_INFO_URL ?? "https://api.hyperliquid.xyz/info") {}

  async candles(coin: string, interval: Interval, bars: number, endMs = Date.now()): Promise<Candle[]> {
    const step = INTERVAL_MS[interval];
    const out = new Map<number, Candle>();
    let cursor = endMs - step * bars;
    for (let guard = 0; guard < 20 && cursor < endMs; guard++) {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "candleSnapshot", req: { coin, interval, startTime: cursor, endTime: endMs } }),
      });
      if (!res.ok) throw new Error(`시세를 받지 못했습니다 (Hyperliquid ${res.status})`);
      const rows = (await res.json()) as { t: number; T: number; o: string; h: string; l: string; c: string; v: string }[];
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const k of rows) out.set(k.t, { t: k.t, T: k.T, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v });
      const last = rows[rows.length - 1].t;
      if (last + step <= cursor) break;
      cursor = last + step;
      if (rows.length < 500) break;
    }
    return [...out.values()].sort((a, b) => a.t - b.t);
  }
}

/** 아직 만들어지는 중인 봉을 뺀다. */
export const closedOnly = (cs: Candle[], now = Date.now()) => cs.filter((k) => k.T < now);
