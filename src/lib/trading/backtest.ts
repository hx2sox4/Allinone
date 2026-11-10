// 백테스트. 한 번에 한 포지션, 신호 다음 봉 시가 진입, 수수료·슬리피지 차감,
// 한 봉 안에서 손절과 목표가 모두 닿으면 손절로 본다(보수적). 결과는 R(처음 위험 금액 대비 배수)로 잰다.
import type { Candle } from "@/lib/market/hyperliquid";
import { series, type Side, type Strategy } from "./strategies";

export interface Costs { feeTaker: number; feeMaker: number; slippage: number }
/** Propr 주문창 기준 수수료(사용자 PC propr_bot/bot.py 주석): 시장가 0.045%, 지정가 0.015%. 슬리피지는 가정값. */
export const PROPR_COSTS: Costs = { feeTaker: 0.00045, feeMaker: 0.00015, slippage: 0.0001 };

export interface BtTrade { side: Side; entryAt: number; exitAt: number; entry: number; exit: number; r: number; reason: "stop" | "target" | "time" }
export interface BtStats { trades: number; winRate: number; avgR: number; totalR: number; profitFactor: number; maxDrawdownR: number }
export interface BtResult { strategy: string; train: BtStats; verify: BtStats; trades: BtTrade[]; splitAt: number; passed: boolean; why: string }

export function stats(ts: BtTrade[]): BtStats {
  const n = ts.length;
  const wins = ts.filter((t) => t.r > 0);
  const gain = wins.reduce((a, t) => a + t.r, 0);
  const loss = -ts.filter((t) => t.r <= 0).reduce((a, t) => a + t.r, 0);
  let eq = 0, peak = 0, dd = 0;
  for (const t of ts) { eq += t.r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const total = ts.reduce((a, t) => a + t.r, 0);
  return { trades: n, winRate: n ? wins.length / n : 0, avgR: n ? total / n : 0, totalR: total, profitFactor: loss > 0 ? gain / loss : gain > 0 ? Infinity : 0, maxDrawdownR: dd };
}

/** 한 거래의 R. 수수료는 진입·청산 금액 모두에 붙는다. 목표가 청산은 지정가 수수료로 본다. */
export function tradeR(side: Side, entry: number, stop: number, exit: number, reason: BtTrade["reason"], k: Costs): number {
  const dir = side === "long" ? 1 : -1;
  const risk = Math.abs(entry - stop);
  const exitFee = reason === "target" ? k.feeMaker : k.feeTaker + k.slippage;
  const fees = entry * (k.feeTaker + k.slippage) + exit * exitFee;
  return ((exit - entry) * dir - fees) / risk;
}

export function backtest(cs: Candle[], st: Strategy, k: Costs = PROPR_COSTS, trainShare = 0.7): BtResult {
  const s = series(cs);
  const trades: BtTrade[] = [];
  let i = 200;
  while (i < cs.length - 1) {
    const sig = st.signal(s, i);
    if (!sig) { i++; continue; }
    const e = i + 1;
    const entry = s.o[e] * (1 + (sig.side === "long" ? k.slippage : -k.slippage));
    const risk = sig.side === "long" ? entry - sig.stop : sig.stop - entry;
    if (!(risk > 0)) { i++; continue; }
    const target = sig.side === "long" ? entry + risk * sig.targetR : entry - risk * sig.targetR;
    let j = e, exit = NaN, reason: BtTrade["reason"] = "time";
    for (; j < cs.length; j++) {
      const hitStop = sig.side === "long" ? s.l[j] <= sig.stop : s.h[j] >= sig.stop;
      const hitTarget = sig.side === "long" ? s.h[j] >= target : s.l[j] <= target;
      if (hitStop) { exit = sig.stop; reason = "stop"; break; }
      if (hitTarget) { exit = target; reason = "target"; break; }
      if (j - e + 1 >= st.maxBars) { exit = s.c[j]; reason = "time"; break; }
    }
    if (j >= cs.length) break; // 끝나지 않은 거래는 세지 않는다
    trades.push({ side: sig.side, entryAt: cs[e].t, exitAt: cs[j].T, entry, exit, reason, r: tradeR(sig.side, entry, sig.stop, exit, reason, k) });
    i = j + 1;
  }
  const splitAt = cs[Math.floor(cs.length * trainShare)]?.t ?? 0;
  const train = stats(trades.filter((t) => t.entryAt < splitAt));
  const verify = stats(trades.filter((t) => t.entryAt >= splitAt));
  const { passed, why } = judge(train, verify);
  return { strategy: st.key, train, verify, trades, splitAt, passed, why };
}

/** 통과 기준: 검증 구간 거래 10건 이상, 학습·검증 모두 수수료 뒤 평균 R이 0보다 큼. */
export const MIN_VERIFY_TRADES = 10;
export function judge(train: BtStats, verify: BtStats): { passed: boolean; why: string } {
  if (verify.trades < MIN_VERIFY_TRADES) return { passed: false, why: `검증 구간 거래가 ${verify.trades}건뿐이라 판단할 수 없음(${MIN_VERIFY_TRADES}건 이상 필요)` };
  if (train.avgR <= 0) return { passed: false, why: "학습 구간에서 수수료 뒤 손실" };
  if (verify.avgR <= 0) return { passed: false, why: "검증 구간에서 수수료 뒤 손실" };
  return { passed: true, why: "학습·검증 모두 수수료 뒤 이익" };
}
