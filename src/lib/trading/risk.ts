// 리스크 규칙. 주문은 이 검사를 통과해야만 나간다. LLM은 이 숫자를 바꿀 수 없다.
import type { Side } from "./strategies";

export interface RiskInput {
  balance: number;
  riskPct: number;
  maxLeverage: number;
  dailyStopPct: number;
  /** 오늘(UTC) 실현 손익 */
  todayPnl: number;
  /** 같은 종목에 열린 포지션이 있는지 */
  hasOpen: boolean;
  side: Side;
  entry: number;
  stop: number;
  /** 뉴스 분석가가 위험 회피를 냈는지 */
  newsRiskOff: boolean;
  /** 수량 자릿수 */
  qtyDecimals?: number;
}
export type RiskDecision = { ok: true; qty: number; notional: number; riskUsd: number; note: string } | { ok: false; reason: string };

export function checkRisk(r: RiskInput): RiskDecision {
  if (r.hasOpen) return { ok: false, reason: "같은 종목에 이미 열린 포지션이 있습니다" };
  if (r.newsRiskOff) return { ok: false, reason: "뉴스 분석가가 위험 회피 의견을 냈습니다" };
  if (r.todayPnl <= -(r.balance * r.dailyStopPct) / 100) return { ok: false, reason: `오늘 실현 손실이 일일 한도 ${r.dailyStopPct}%에 닿았습니다` };
  const perUnit = r.side === "long" ? r.entry - r.stop : r.stop - r.entry;
  if (!(perUnit > 0)) return { ok: false, reason: "손절가가 진입가의 잘못된 쪽에 있습니다" };
  const riskUsd = (r.balance * r.riskPct) / 100;
  let qty = riskUsd / perUnit;
  let note = `1회 위험 ${r.riskPct}% = ${riskUsd.toFixed(2)} USDC`;
  const cap = (r.balance * r.maxLeverage) / r.entry;
  if (qty > cap) { qty = cap; note += `, 레버리지 상한 ${r.maxLeverage}배로 수량 축소`; }
  const d = r.qtyDecimals ?? 5;
  qty = Math.floor(qty * 10 ** d) / 10 ** d;
  if (qty <= 0) return { ok: false, reason: "계좌 규모로는 최소 수량을 살 수 없습니다" };
  return { ok: true, qty, notional: qty * r.entry, riskUsd: qty * perUnit, note };
}
