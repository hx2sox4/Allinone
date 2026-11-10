import { db } from "./db";
import type { Storage } from "./storage";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 문구를 얹은 이미지를 원본의 새 버전으로 저장한다. 원본은 그대로 남는다. */
export async function saveComposedVersion(
  args: { workspaceId: string; assetId: string; png: Buffer; overlayText: string; virtualPersonLabel: boolean },
  storage: Storage,
) {
  const src = await db.asset.findFirst({ where: { id: args.assetId, workspaceId: args.workspaceId } });
  if (!src) throw new Error("시안을 찾을 수 없습니다");
  if (src.kind !== "IMAGE") throw new Error("문구는 이미지에만 얹을 수 있습니다");
  if (args.png.length < 8 || !args.png.subarray(0, 8).equals(PNG_MAGIC)) throw new Error("PNG 이미지가 아닙니다");
  const rootId = src.parentAssetId ?? src.id; // 버전은 항상 원본 아래에 쌓는다.
  const last = await db.asset.findFirst({ where: { OR: [{ id: rootId }, { parentAssetId: rootId }] }, orderBy: { version: "desc" } });
  const version = (last?.version ?? 1) + 1;
  const key = `${src.workspaceId}/${src.jobId}/v${version}-${rootId}.png`;
  await storage.put(key, args.png, "image/png");
  return db.asset.create({
    data: {
      workspaceId: src.workspaceId,
      jobId: src.jobId,
      kind: "IMAGE",
      storageKey: key,
      contentType: "image/png",
      bytes: args.png.length,
      sourceUrl: `composed:${rootId}:v${version}`,
      parentAssetId: rootId,
      version,
      overlayText: args.overlayText.slice(0, 500),
      virtualPersonLabel: args.virtualPersonLabel,
    },
  });
}
