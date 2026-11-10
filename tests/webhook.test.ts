import { describe, expect, it } from "vitest";
import { Webhook } from "standardwebhooks";
import { WebhookVerificationError, verifyWebhook } from "@/lib/higgsfield/webhook";

const secret = "whsec_dGVzdC1zZWNyZXQtdGVzdC1zZWNyZXQtdGVzdA==";
const body = JSON.stringify({ request_id: "r1", status: "completed", error: null, expires_at: null, payload: { images: [{ url: "https://x/y.png" }] } });

function sign(at: Date, id = "msg_1", payload = body) {
  return { "webhook-id": id, "webhook-timestamp": String(Math.floor(at.getTime() / 1000)), "webhook-signature": new Webhook(secret).sign(id, at, payload) };
}

describe("웹훅 서명 검증", () => {
  it("올바른 서명은 통과하고 본문을 돌려준다", () => {
    const { webhookId, envelope } = verifyWebhook(body, sign(new Date()), secret);
    expect(webhookId).toBe("msg_1");
    expect(envelope.request_id).toBe("r1");
    expect(envelope.payload?.images?.[0].url).toBe("https://x/y.png");
  });
  it("본문이 한 글자라도 바뀌면 거부한다", () => {
    expect(() => verifyWebhook(body.replace("r1", "r2"), sign(new Date()), secret)).toThrow(WebhookVerificationError);
  });
  it("다른 비밀값으로 서명된 요청은 거부한다", () => {
    const other = "whsec_b3RoZXItc2VjcmV0LW90aGVyLXNlY3JldC1vdGhlcg==";
    expect(() => verifyWebhook(body, sign(new Date()), other)).toThrow(WebhookVerificationError);
  });
  it("5분 넘게 지난 타임스탬프는 거부한다", () => {
    expect(() => verifyWebhook(body, sign(new Date(Date.now() - 6 * 60_000)), secret)).toThrow(WebhookVerificationError);
  });
  it("서명 헤더가 없으면 거부한다", () => {
    expect(() => verifyWebhook(body, {}, secret)).toThrow(WebhookVerificationError);
  });
});
