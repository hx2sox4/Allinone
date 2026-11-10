import { canEdit, currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { answerAsk } from "@/lib/missions";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  if (!canEdit(c.role)) return Response.json({ error: "권한이 없습니다" }, { status: 403 });
  const m = await db.mission.findFirst({ where: { id, workspaceId: c.workspace.id } });
  if (!m) return new Response("not found", { status: 404 });
  try {
    const body = (await req.json()) as { requestId?: string; allow?: boolean };
    await answerAsk(id, String(body.requestId ?? ""), body.allow === true);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "처리하지 못했습니다" }, { status: 400 });
  }
}
