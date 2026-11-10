import { canEdit, currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { startMission } from "@/lib/missions";

const view = (m: { id: string; title: string; prompt: string; status: string; createdAt: Date; endedAt: Date | null }) => ({ id: m.id, title: m.title, prompt: m.prompt, status: m.status, createdAt: m.createdAt.getTime(), endedAt: m.endedAt?.getTime() ?? null });

export async function GET() {
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  const rows = await db.mission.findMany({ where: { workspaceId: c.workspace.id }, orderBy: { createdAt: "desc" }, take: 30 });
  return Response.json({ missions: rows.map(view) });
}

export async function POST(req: Request) {
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  if (!c.brand) return Response.json({ error: "브랜드 기억을 먼저 저장해 주세요" }, { status: 400 });
  if (!canEdit(c.role)) return Response.json({ error: "일을 맡길 권한이 없습니다" }, { status: 403 });
  try {
    const body = (await req.json()) as { prompt?: string };
    const m = await startMission({ workspaceId: c.workspace.id, userId: c.user.id, prompt: String(body.prompt ?? "") });
    return Response.json({ mission: view(m) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "일을 시작하지 못했습니다" }, { status: 400 });
  }
}
