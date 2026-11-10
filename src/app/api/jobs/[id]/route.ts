import { currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { isCopyPending, isTerminal, refreshJob } from "@/lib/jobs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  let job = await db.generationJob.findFirst({ where: { id, workspaceId: c.workspace.id } });
  if (!job) return new Response("not found", { status: 404 });
  // 웹훅이 오지 않아도 화면이 멈추지 않도록, 3초 넘게 확인하지 않은 진행 중 작업은 직접 조회한다.
  const stale = !job.lastCheckedAt || Date.now() - job.lastCheckedAt.getTime() > 3000;
  if (job.hfRequestId && !isTerminal(job.status) && stale) {
    await db.generationJob.update({ where: { id }, data: { lastCheckedAt: new Date() } });
    await refreshJob(id).catch(() => {});
  }
  job = await db.generationJob.findUniqueOrThrow({ where: { id } });
  const assets = await db.asset.findMany({ where: { jobId: id, parentAssetId: null }, orderBy: { createdAt: "asc" } });
  return Response.json({
    id: job.id,
    status: job.status,
    error: job.error,
    pendingCopy: isCopyPending(job, assets.length),
    assets: assets.map((a) => ({ id: a.id, kind: a.kind })),
  });
}
