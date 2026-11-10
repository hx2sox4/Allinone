import { db } from "@/lib/db";
import type { MarketData } from "@/lib/market/hyperliquid";
import { paperAccount, todayPnl, updateOpenTrades } from "./paper";

export interface TradeRow { id: string; coin: string; side: string; qty: number; entry: number; stop: number; target: number; strategy: string; interval: string; openedAt: number; closeBy: number; status: string; exit: number | null; exitReason: string | null; closedAt: number | null; fees: number; pnl: number | null; checkedTo: number }
export interface AccountSummary { startEquity: number; balance: number; riskPct: number; dailyStopPct: number; maxLeverage: number; todayPnl: number; open: TradeRow[]; closed: TradeRow[]; wins: number; losses: number; updateError: string | null }

/** 열린 포지션을 시세로 확인한 뒤 계좌 요약을 돌려준다. 시세를 못 받으면 마지막 상태와 오류를 함께 준다. */
export async function accountSummary(workspaceId: string, market: MarketData | null, now = Date.now()): Promise<AccountSummary> {
  await paperAccount(workspaceId);
  const upd = market ? await updateOpenTrades(workspaceId, market, now) : { error: undefined };
  const a = await db.paperAccount.findUniqueOrThrow({ where: { workspaceId } });
  const rows = await db.paperTrade.findMany({ where: { workspaceId }, orderBy: { openedAt: "desc" }, take: 100 });
  const v = (t: (typeof rows)[number]): TradeRow => ({ ...t, openedAt: t.openedAt.getTime(), closeBy: t.closeBy.getTime(), closedAt: t.closedAt?.getTime() ?? null, checkedTo: t.checkedTo.getTime(), missionId: undefined } as unknown as TradeRow);
  const closed = rows.filter((t) => t.status === "closed");
  return {
    startEquity: a.startEquity, balance: a.balance, riskPct: a.riskPct, dailyStopPct: a.dailyStopPct, maxLeverage: a.maxLeverage, todayPnl: await todayPnl(workspaceId, now),
    open: rows.filter((t) => t.status === "open").map(v), closed: closed.map(v),
    wins: closed.filter((t) => (t.pnl ?? 0) > 0).length, losses: closed.filter((t) => (t.pnl ?? 0) <= 0).length,
    updateError: upd.error ?? null,
  };
}
