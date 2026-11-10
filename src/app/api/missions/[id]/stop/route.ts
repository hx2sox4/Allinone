import { canEdit, currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { stopMission } from "@/lib/missions";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  if (!canEdit(c.role)) return Response.json({ error: "권한이 없습니다" }, { status: 403 });
  const m = await db.mission.findFirst({ where: { id, workspaceId: c.workspace.id } });
  if (!m) return new Response("not found", { status: 404 });
  await stopMission(id);
  return Response.json({ ok: true });
}
