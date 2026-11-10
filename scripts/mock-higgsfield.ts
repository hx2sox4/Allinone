// 모의 Higgsfield 서버. 문서(docs.higgsfield.ai)에 적힌 요청과 응답 모양만 흉내 낸다.
// 실제 생성은 하지 않고 고정된 작은 PNG와 MP4 바이트를 돌려준다.
// 프롬프트에 [nsfw]가 있으면 nsfw, [fail]이 있으면 failed로 끝난다.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { Webhook } from "standardwebhooks";
import raw from "../src/lib/higgsfield/models.json";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
/** 외부 라이브러리 없이 만드는 단색 그라데이션 PNG. 화면에서 실제 크기의 시안처럼 보이게 하려는 용도다. */
export function makePng(w: number, h: number, seed: number): Buffer {
  const a = [(seed * 53) % 200 + 40, (seed * 97) % 200 + 40, (seed * 31) % 200 + 40];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      for (let k = 0; k < 3; k++) raw[row + 1 + x * 3 + k] = Math.round(a[k] * (1 - t) + 245 * t);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(12)]);

interface Req {
  id: string;
  kind: "image" | "video";
  outcome: "completed" | "failed" | "nsfw";
  polls: number;
  status: string;
  batch: number;
  ratio: string;
  webhook?: string;
}

export interface MockOptions {
  port?: number;
  webhookSecret?: string;
  /** 완료까지 필요한 상태 조회 횟수 */
  pollsToComplete?: number;
  /** 웹훅을 보내기까지의 지연(ms). 0이면 보내지 않는다. */
  webhookDelayMs?: number;
}

export interface MockServer {
  url: string;
  server: Server;
  submissions: { endpoint: string; idempotencyKey?: string; body: unknown }[];
  uploads: Map<string, { data: Buffer; contentType: string; headers: Record<string, string | string[] | undefined> }>;
  requests: Map<string, Req>;
  close(): Promise<void>;
}

const readRaw = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
const readBody = async (req: IncomingMessage) => (await readRaw(req)).toString("utf8");

export async function startMockHiggsfield(opts: MockOptions = {}): Promise<MockServer> {
  const endpoints = new Map(raw.models.map((m) => [m.endpoint, m.kind as "image" | "video"]));
  const requests = new Map<string, Req>();
  const byIdem = new Map<string, string>();
  const submissions: MockServer["submissions"] = [];
  const uploads: MockServer["uploads"] = new Map();
  const pollsToComplete = opts.pollsToComplete ?? 2;
  let base = "";

  const result = (r: Req) => {
    const out: Record<string, unknown> = { status: r.status, request_id: r.id };
    if (r.status === "completed") {
      out.expires_at = new Date(Date.now() + 7 * 86400_000).toISOString();
      if (r.kind === "image") out.images = Array.from({ length: r.batch }, (_, i) => ({ url: `${base}/files/${r.id}-${i}.png`, content_type: "image/png" }));
      else out.video = { url: `${base}/files/${r.id}.mp4` };
    }
    if (r.status === "failed") out.error = "mock failure";
    return out;
  };

  const sendWebhook = async (r: Req) => {
    if (!r.webhook) return;
    r.status = r.outcome;
    const { status, request_id, expires_at, error, ...payload } = result(r) as Record<string, unknown>;
    const body = JSON.stringify({ request_id, status, error: error ?? null, expires_at: expires_at ?? null, payload: status === "completed" ? payload : null });
    const id = `msg_${randomUUID()}`;
    const ts = new Date();
    const headers: Record<string, string> = { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(Math.floor(ts.getTime() / 1000)) };
    if (opts.webhookSecret) headers["webhook-signature"] = new Webhook(opts.webhookSecret).sign(id, ts, body);
    await fetch(r.webhook, { method: "POST", headers, body }).catch(() => {});
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const json = (code: number, obj: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(obj === undefined ? "" : JSON.stringify(obj));
    };
    const up = url.pathname.match(/^\/upload\/([^/]+)$/);
    if (up && req.method === "PUT") {
      // 실제 서비스의 사전 서명 주소처럼 API 키 없이 받는다.
      uploads.set(up[1], { data: await readRaw(req), contentType: String(req.headers["content-type"] ?? ""), headers: req.headers });
      res.writeHead(200);
      return res.end();
    }
    const upFile = url.pathname.match(/^\/files\/upload-([^/.]+)\./);
    if (upFile && req.method === "GET") {
      const f = uploads.get(upFile[1]);
      if (!f) return json(404, { detail: "Not found" });
      res.writeHead(200, { "content-type": f.contentType });
      return res.end(f.data);
    }
    if (url.pathname.startsWith("/files/") && req.method === "GET") {
      const mp4 = url.pathname.endsWith(".mp4");
      res.writeHead(200, { "content-type": mp4 ? "video/mp4" : "image/png" });
      if (mp4) return res.end(MP4);
      // 요청한 화면비대로 가로 640 기준의 이미지를 돌려준다.
      const m = url.pathname.match(/^\/files\/(.+)-(\d+)\.png$/);
      const r = m ? requests.get(m[1]) : undefined;
      if (!r) return res.end(PNG);
      const [rw, rh] = r.ratio.split(":").map(Number);
      return res.end(makePng(640, Math.round((640 * rh) / rw), [...r.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) + Number(m![2]) * 7));
    }
    if (!/^Key .+:.+$/.test(req.headers.authorization ?? "")) return json(401, { detail: "Invalid credentials" });
    const bodyText = req.method === "POST" ? await readBody(req) : "";
    const body = bodyText ? JSON.parse(bodyText) : {};

    if (req.method === "POST" && url.pathname.startsWith("/estimate/")) {
      const ep = url.pathname.slice("/estimate".length);
      if (!endpoints.has(ep)) return json(404, { detail: "Not found" });
      // 금액은 모의 값이다. 실제 금액은 실제 견적 응답만이 기준이다.
      // 응답 형태는 실제와 같게 둔다. Seedance는 실제로도 금액 없이 설명만 온다.
      if (ep.includes("seedance")) return json(200, { type: "description", pricing_description: "모의 설명: 사용량 기준으로 과금됩니다." });
      const usd = endpoints.get(ep) === "video" ? "0.350" : (0.05 * (body.batch_size ?? 1)).toFixed(3);
      return json(200, { type: "estimate", credits: (Number(usd) * 16).toFixed(3), usd, discount: null });
    }
    if (req.method === "POST" && url.pathname === "/files/generate-upload-url") {
      const id = randomUUID();
      return json(200, { public_url: `${base}/files/upload-${id}.png`, upload_url: `${base}/upload/${id}`, content_type: body.content_type, upload_headers: { "x-amz-tagging": "retention=temporary" } });
    }
    if (req.method === "POST" && endpoints.has(url.pathname)) {
      const idem = req.headers["idempotency-key"] as string | undefined;
      submissions.push({ endpoint: url.pathname, idempotencyKey: idem, body });
      let id = idem ? byIdem.get(idem) : undefined;
      if (!id) {
        id = randomUUID();
        if (idem) byIdem.set(idem, id);
        const prompt = String(body.prompt ?? "");
        const r: Req = {
          id,
          kind: endpoints.get(url.pathname)!,
          outcome: prompt.includes("[nsfw]") ? "nsfw" : prompt.includes("[fail]") ? "failed" : "completed",
          polls: 0,
          status: "queued",
          batch: body.batch_size ?? 1,
          ratio: typeof body.aspect_ratio === "string" ? body.aspect_ratio : "1:1",
          webhook: url.searchParams.get("hf_webhook") ?? undefined,
        };
        requests.set(id, r);
        if (r.webhook && (opts.webhookDelayMs ?? 0) > 0) setTimeout(() => void sendWebhook(r), opts.webhookDelayMs);
      }
      return json(200, { status: "queued", request_id: id, status_url: `${base}/requests/${id}/status`, cancel_url: `${base}/requests/${id}/cancel`, expires_after: 604800 });
    }
    const m = url.pathname.match(/^\/requests\/([^/]+)\/(status|cancel)$/);
    if (m) {
      const r = requests.get(m[1]);
      if (!r) return json(404, { detail: "Not found" });
      if (m[2] === "cancel" && req.method === "POST") {
        if (r.status !== "queued") return json(400, { detail: "Request already started" });
        r.status = "canceled";
        return json(202, undefined);
      }
      if (m[2] === "status" && req.method === "GET") {
        if (!["completed", "failed", "nsfw", "canceled"].includes(r.status)) {
          r.polls++;
          r.status = r.polls >= pollsToComplete ? r.outcome : "in_progress";
        }
        return json(200, result(r));
      }
    }
    return json(404, { detail: "Not found" });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : opts.port}`;
  return { url: base, server, submissions, uploads, requests, close: () => new Promise((r) => server.close(() => r())) };
}

// 직접 실행: npm run mock
if (process.argv[1]?.endsWith("mock-higgsfield.ts")) {
  void (async () => {
    await import("./load-env");
    const s = await startMockHiggsfield({ port: 4010, webhookSecret: process.env.HF_WEBHOOK_SECRET, pollsToComplete: 3, webhookDelayMs: 6000 });
    console.log(`모의 Higgsfield 서버: ${s.url}`);
  })();
}
