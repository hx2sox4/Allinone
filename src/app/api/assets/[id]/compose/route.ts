import { canEdit, currentContext } from "@/lib/auth";
import { storageFromEnv } from "@/lib/storage";
import { saveComposedVersion } from "@/lib/versions";

// 화면에서 문구를 얹어 만든 PNG를 새 버전으로 저장한다.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  if (!canEdit(c.role)) return new Response("forbidden", { status: 403 });
  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof File) || file.size > 25 * 1024 * 1024) return Response.json({ error: "이미지를 저장하지 못했습니다" }, { status: 400 });
  try {
    const asset = await saveComposedVersion(
      { workspaceId: c.workspace.id, assetId: id, png: Buffer.from(await file.arrayBuffer()), overlayText: String(form.get("overlayText") ?? ""), virtualPersonLabel: form.get("virtualPersonLabel") === "true" },
      storageFromEnv(),
    );
    return Response.json({ id: asset.id, version: asset.version });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "저장하지 못했습니다" }, { status: 400 });
  }
}
