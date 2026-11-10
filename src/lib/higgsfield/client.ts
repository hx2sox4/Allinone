// Higgsfield HTTP 클라이언트. 서버에서만 불러와야 한다.
// 공식 TypeScript SDK(@higgsfield/client) 대신 얇은 클라이언트를 쓰는 이유:
// SDK의 메서드 구성을 문서로 확인하지 못했고, 문서로 확인한 HTTP 규격만 쓰기 위해서다.
// 규격 출처: https://docs.higgsfield.ai/docs/concepts/requests.md, billing-and-retention.md, file-uploads.md

export type HfStatus = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
export const HF_TERMINAL: HfStatus[] = ["completed", "failed", "nsfw", "canceled"];

export interface HfHandle {
  status: HfStatus;
  request_id: string;
  status_url: string;
  cancel_url: string;
  expires_after?: number;
}

export interface HfStatusResponse {
  status: HfStatus;
  request_id: string;
  expires_at?: string | null;
  error?: unknown;
  images?: { url: string; content_type?: string }[];
  video?: { url: string };
}

/** usd가 null이면 정액 견적이 없는 모델이다. note에 Higgsfield가 준 과금 설명이 들어 있다. */
export interface HfEstimate {
  usd: string | null;
  note: string | null;
}

export class HiggsfieldError extends Error {
  constructor(public httpStatus: number, public body: string) {
    super(`Higgsfield 응답 오류 ${httpStatus}: ${body.slice(0, 300)}`);
  }
}

export interface HiggsfieldConfig {
  baseUrl: string;
  keyId: string;
  keySecret: string;
  fetchImpl?: typeof fetch;
}

export function configFromEnv(): HiggsfieldConfig {
  const baseUrl = process.env.HF_API_BASE ?? "https://api.higgsfield.ai";
  const keyId = process.env.HF_API_KEY_ID;
  const keySecret = process.env.HF_API_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("HF_API_KEY_ID와 HF_API_KEY_SECRET 환경 변수가 필요합니다");
  return { baseUrl, keyId, keySecret };
}

export class HiggsfieldClient {
  private fetchImpl: typeof fetch;
  constructor(private cfg: HiggsfieldConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async call<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Key ${this.cfg.keyId}:${this.cfg.keySecret}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new HiggsfieldError(res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * 제출과 같은 본문으로 예상 비용을 받는다. 실제 응답은 두 형태다(2026-11-10 실제 호출로 확인).
   * - {"type":"estimate","credits":"0.240","usd":"0.015","discount":null}: 정액 견적
   * - {"type":"description","pricing_description":"..."}: 사용량 기준 과금이라 금액이 없고 설명만 온다
   */
  async estimate(endpoint: string, input: unknown): Promise<HfEstimate> {
    const r = await this.call<{ type?: string; usd?: unknown; pricing_description?: unknown }>("POST", `${this.cfg.baseUrl}/estimate${endpoint}`, input);
    if (typeof r.usd === "string" && /^\d+(\.\d+)?$/.test(r.usd)) return { usd: r.usd, note: null };
    if (typeof r.pricing_description === "string" && r.pricing_description) return { usd: null, note: r.pricing_description };
    throw new Error("Higgsfield 견적 응답을 해석하지 못했습니다");
  }

  /** idempotencyKey는 우리 작업 id에서 만든다. 시간 초과 후 다시 보내도 중복 생성되지 않는다. */
  async submit(endpoint: string, input: unknown, opts: { idempotencyKey: string; webhookUrl?: string }): Promise<HfHandle> {
    let url = `${this.cfg.baseUrl}${endpoint}`;
    if (opts.webhookUrl) url += `?hf_webhook=${encodeURIComponent(opts.webhookUrl)}`;
    return this.call("POST", url, input, { "Idempotency-Key": opts.idempotencyKey });
  }

  async status(requestId: string): Promise<HfStatusResponse> {
    return this.call("GET", `${this.cfg.baseUrl}/requests/${encodeURIComponent(requestId)}/status`);
  }

  /** queued 상태에서만 성공한다. 이미 처리 중이면 400이 온다. */
  async cancel(requestId: string): Promise<void> {
    await this.call("POST", `${this.cfg.baseUrl}/requests/${encodeURIComponent(requestId)}/cancel`);
  }

  async createUploadUrl(contentType: string): Promise<{ public_url: string; upload_url: string; upload_headers: Record<string, string> }> {
    return this.call("POST", `${this.cfg.baseUrl}/files/generate-upload-url`, { content_type: contentType });
  }
}
