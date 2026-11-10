import { canEdit, currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { storageFromEnv } from "@/lib/storage";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX = 10 * 1024 * 1024;

// 제품 사진과 로고 올리기 (브랜드 키트)
export async function POST(req: Request) {
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  if (!canEdit(c.role)) return new Response("forbidden", { status: 403 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "파일을 선택해 주세요" }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return Response.json({ error: "JPG, PNG, WEBP 사진만 올릴 수 있습니다" }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "10MB 이하의 사진만 올릴 수 있습니다" }, { status: 400 });
  const kind = form.get("kind") === "LOGO" ? "LOGO" : "PRODUCT";
  const data = Buffer.from(await file.arrayBuffer());
  const row = await db.brandAsset.create({ data: { workspaceId: c.workspace.id, kind, name: file.name.slice(0, 120), storageKey: "", contentType: file.type, bytes: data.length } });
  const key = `${c.workspace.id}/brand/${row.id}.${ext}`;
  await storageFromEnv().put(key, data, file.type);
  await db.brandAsset.update({ where: { id: row.id }, data: { storageKey: key } });
  return Response.json({ id: row.id, name: row.name, kind });
}
