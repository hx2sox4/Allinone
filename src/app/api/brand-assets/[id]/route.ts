import { currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { storageFromEnv } from "@/lib/storage";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  const a = await db.brandAsset.findFirst({ where: { id, workspaceId: c.workspace.id } });
  if (!a || !a.storageKey) return new Response("not found", { status: 404 });
  const data = await storageFromEnv().get(a.storageKey);
  return new Response(new Uint8Array(data), { headers: { "content-type": a.contentType, "cache-control": "private, max-age=3600" } });
}
