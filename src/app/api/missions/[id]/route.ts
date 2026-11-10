import { after } from "next/server";
import { currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { advanceMission, eventsAfter } from "@/lib/missions";

/** 기록을 돌려준다. 진행 중인 임무는 이 요청이 올 때마다 한 걸음씩 나아간다. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  const m = await db.mission.findFirst({ where: { id, workspaceId: c.workspace.id } });
  if (!m) return new Response("not found", { status: 404 });
  const from = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
  if (m.status === "working") after(() => advanceMission(id).catch(() => {}));
  const events = await eventsAfter(id, from);
  return Response.json({ mission: { id: m.id, title: m.title, prompt: m.prompt, status: m.status, createdAt: m.createdAt.getTime(), endedAt: m.endedAt?.getTime() ?? null }, events });
}
