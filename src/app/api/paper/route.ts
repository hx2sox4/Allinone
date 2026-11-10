import { z } from "zod";
import { canEdit, currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { HyperliquidMarket } from "@/lib/market/hyperliquid";
import { accountSummary } from "@/lib/trading/account-view";
import { closeManually, paperAccount } from "@/lib/trading/paper";

const market = new HyperliquidMarket();

export async function GET() {
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  return Response.json(await accountSummary(c.workspace.id, market));
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("settings"), riskPct: z.number().min(0.05).max(2), dailyStopPct: z.number().min(0.5).max(10), maxLeverage: z.number().min(0.1).max(5) }),
  z.object({ action: z.literal("close"), tradeId: z.string() }),
  z.object({ action: z.literal("reset") }),
]);

export async function POST(req: Request) {
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  if (!canEdit(c.role)) return Response.json({ error: "권한이 없습니다" }, { status: 403 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "값이 허용 범위를 벗어났습니다" }, { status: 400 });
  const ws = c.workspace.id;
  await paperAccount(ws);
  try {
    if (p.data.action === "settings") {
      const { riskPct, dailyStopPct, maxLeverage } = p.data;
      await db.paperAccount.update({ where: { workspaceId: ws }, data: { riskPct, dailyStopPct, maxLeverage } });
    } else if (p.data.action === "close") {
      await closeManually(ws, p.data.tradeId, market);
    } else {
      // 모의 계좌 초기화: 거래 기록을 지우고 잔고를 처음으로 돌린다.
      await db.$transaction([db.paperTrade.deleteMany({ where: { workspaceId: ws } }), db.paperAccount.update({ where: { workspaceId: ws }, data: { balance: 10000, startEquity: 10000 } })]);
    }
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "처리하지 못했습니다" }, { status: 400 });
  }
  return Response.json(await accountSummary(ws, null));
}
