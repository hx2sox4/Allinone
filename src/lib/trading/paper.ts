// 모의매매 장부. 실제 주문은 하지 않는다. 체결은 시세에 슬리피지를 더한 값으로 가정한다.
import type { PaperAccount, PaperTrade } from "@prisma/client";
import { db } from "@/lib/db";
import { INTERVAL_MS, type Interval, type MarketData } from "@/lib/market/hyperliquid";
import { PROPR_COSTS, type Costs } from "./backtest";
import type { Side } from "./strategies";

export async function paperAccount(workspaceId: string): Promise<PaperAccount> {
  return db.paperAccount.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} });
}

const dayStart = (now = Date.now()) => new Date(Math.floor(now / 86_400_000) * 86_400_000);

export async function todayPnl(workspaceId: string, now = Date.now()): Promise<number> {
  const rows = await db.paperTrade.findMany({ where: { workspaceId, status: "closed", closedAt: { gte: dayStart(now) } }, select: { pnl: true } });
  return rows.reduce((a, r) => a + (r.pnl ?? 0), 0);
}

export async function openPaperTrade(args: { workspaceId: string; missionId?: string; coin: string; side: Side; qty: number; price: number; stop: number; target: number; strategy: string; interval: Interval; maxBars: number; costs?: Costs; now?: number }): Promise<PaperTrade> {
  const k = args.costs ?? PROPR_COSTS;
  const now = args.now ?? Date.now();
  const entry = args.price * (1 + (args.side === "long" ? k.slippage : -k.slippage));
  const fee = entry * args.qty * k.feeTaker;
  return db.$transaction(async (tx) => {
    await tx.paperAccount.update({ where: { workspaceId: args.workspaceId }, data: { balance: { decrement: fee } } });
    return tx.paperTrade.create({
      data: {
        workspaceId: args.workspaceId, missionId: args.missionId, coin: args.coin, side: args.side, qty: args.qty, entry, stop: args.stop, target: args.target,
        strategy: args.strategy, interval: args.interval, openedAt: new Date(now), checkedTo: new Date(now), closeBy: new Date(now + args.maxBars * INTERVAL_MS[args.interval]), fees: fee,
      },
    });
  });
}

async function closeTrade(t: PaperTrade, exit: number, reason: "stop" | "target" | "time" | "manual", at: Date, k: Costs) {
  const dir = t.side === "long" ? 1 : -1;
  const px = reason === "target" ? exit : exit * (1 - dir * k.slippage);
  const fee = px * t.qty * (reason === "target" ? k.feeMaker : k.feeTaker);
  const gross = (px - t.entry) * dir * t.qty;
  const pnl = gross - t.fees - fee;
  await db.$transaction([
    db.paperTrade.update({ where: { id: t.id }, data: { status: "closed", exit: px, exitReason: reason, closedAt: at, fees: t.fees + fee, pnl, checkedTo: at } }),
    db.paperAccount.update({ where: { workspaceId: t.workspaceId }, data: { balance: { increment: gross - fee } } }),
  ]);
}

/**
 * 열린 모의 포지션을 1분봉으로 확인해 손절·목표·보유기간 청산을 처리한다.
 * 한 봉 안에서 손절과 목표가 모두 닿으면 손절로 본다(백테스트와 같은 보수적 가정).
 */
export async function updateOpenTrades(workspaceId: string, market: MarketData, now = Date.now(), k: Costs = PROPR_COSTS): Promise<{ closed: PaperTrade[]; error?: string }> {
  const open = await db.paperTrade.findMany({ where: { workspaceId, status: "open" } });
  const closed: PaperTrade[] = [];
  for (const t of open) {
    const from = t.checkedTo.getTime();
    if (now - from < 60_000) continue;
    const minutes = Math.min(4900, Math.ceil((now - from) / 60_000) + 1);
    let cs;
    try {
      cs = (await market.candles(t.coin, "1m", minutes, now)).filter((c) => c.t >= from - 60_000 && c.T < now);
    } catch (e) {
      return { closed, error: e instanceof Error ? e.message : "시세 오류" };
    }
    let done = false;
    for (const c of cs) {
      if (c.T <= from) continue;
      const hitStop = t.side === "long" ? c.l <= t.stop : c.h >= t.stop;
      const hitTarget = t.side === "long" ? c.h >= t.target : c.l <= t.target;
      if (hitStop) { await closeTrade(t, t.stop, "stop", new Date(c.T), k); done = true; break; }
      if (hitTarget) { await closeTrade(t, t.target, "target", new Date(c.T), k); done = true; break; }
      if (c.T >= t.closeBy.getTime()) { await closeTrade(t, c.c, "time", new Date(c.T), k); done = true; break; }
    }
    if (done) closed.push(await db.paperTrade.findUniqueOrThrow({ where: { id: t.id } }));
    else if (cs.length) await db.paperTrade.update({ where: { id: t.id }, data: { checkedTo: new Date(cs[cs.length - 1].T) } });
  }
  return { closed };
}

export async function closeManually(workspaceId: string, tradeId: string, market: MarketData, now = Date.now(), k: Costs = PROPR_COSTS) {
  const t = await db.paperTrade.findFirst({ where: { id: tradeId, workspaceId, status: "open" } });
  if (!t) throw new Error("열린 포지션이 아닙니다");
  const cs = await market.candles(t.coin, "1m", 3, now);
  const last = cs[cs.length - 1];
  if (!last) throw new Error("현재가를 받지 못했습니다");
  await closeTrade(t, last.c, "manual", new Date(now), k);
}
