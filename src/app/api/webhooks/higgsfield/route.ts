import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { applyStatus } from "@/lib/jobs";
import { WebhookVerificationError, verifyWebhook } from "@/lib/higgsfield/webhook";

// Higgsfield 웹훅 수신. 원문으로 서명을 검증하고, webhook-id로 중복을 걸러 낸 뒤 상태를 반영한다.
// 4xx는 재시도되지 않고 5xx는 최대 2시간 재시도된다.
export async function POST(req: Request) {
  const secret = process.env.HF_WEBHOOK_SECRET;
  if (!secret) return new Response("webhook secret not configured", { status: 503 });
  const raw = await req.text();
  let verified;
  try {
    verified = verifyWebhook(raw, Object.fromEntries(req.headers), secret);
  } catch (e) {
    if (e instanceof WebhookVerificationError) return new Response("invalid signature", { status: 401 });
    throw e;
  }
  const { webhookId, envelope } = verified;
  try {
    await db.webhookDelivery.create({ data: { webhookId, requestId: envelope.request_id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return Response.json({ ok: true, duplicate: true });
    throw e;
  }
  try {
    await applyStatus(envelope.request_id, {
      status: envelope.status,
      error: envelope.error,
      expires_at: envelope.expires_at,
      images: envelope.payload?.images,
      video: envelope.payload?.video,
    });
  } catch (e) {
    // 처리에 실패하면 기록을 지워 재시도 때 다시 처리되게 한다.
    await db.webhookDelivery.delete({ where: { webhookId } }).catch(() => {});
    throw e;
  }
  return Response.json({ ok: true });
}
