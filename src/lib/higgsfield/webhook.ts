import { Webhook } from "standardwebhooks";
import type { HfStatus } from "./client";

// 출처: https://docs.higgsfield.ai/docs/how-to/webhooks.md
// Standard Webhooks 규격. 원문(raw body) 그대로 검증해야 하며 타임스탬프가 5분 넘게 어긋나면 거부된다.

export interface HfWebhookEnvelope {
  request_id: string;
  status: HfStatus;
  error?: unknown;
  expires_at?: string | null;
  payload?: { images?: { url: string; content_type?: string }[]; video?: { url: string } } | null;
}

export class WebhookVerificationError extends Error {}

export function verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, secret: string): { webhookId: string; envelope: HfWebhookEnvelope } {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signature = headers["webhook-signature"];
  if (!id || !timestamp || !signature) throw new WebhookVerificationError("서명 헤더가 없습니다");
  try {
    const envelope = new Webhook(secret).verify(rawBody, {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": signature,
    }) as HfWebhookEnvelope;
    return { webhookId: id, envelope };
  } catch (e) {
    throw new WebhookVerificationError(e instanceof Error ? e.message : "서명 검증 실패");
  }
}
