import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LlmClient, LlmError } from "@/lib/llm/client";
import { checkCopy, writeCopy, type CopyDraft } from "@/lib/llm/copy";

// OpenAI 호환 chat/completions를 흉내 내는 모의 서버. 응답 형태는 DeepSeek 문서와 실제 응답을 따른다.
let server: http.Server;
let url: string;
let queue: { status: number; body: unknown }[] = [];
const seen: { auth?: string; body: Record<string, unknown> }[] = [];

const good: CopyDraft = {
  instagram: { caption: "11월 한 달 동안 생강라떼를 준비했어요.", hashtags: ["생강라떼"] },
  image_overlay: ["직접 끓인 생강청", "생강라떼 5,500원"],
  sms: "(광고)온기 생강라떼 5,500원. 무료수신거부 [수신거부번호]",
};
const completion = (content: string, finish = "stop") => ({
  status: 200,
  body: { model: "deepseek-flash", choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
});
const req = { businessName: "온기", industry: "카페", speechLevel: "존댓말", voice: "다정하게", news: "11월 한 달 생강라떼 5,500원" };

beforeAll(async () => {
  server = http.createServer((rq, rs) => {
    let raw = "";
    rq.on("data", (c) => (raw += c));
    rq.on("end", () => {
      seen.push({ auth: rq.headers.authorization, body: JSON.parse(raw) });
      const next = queue.shift() ?? { status: 500, body: { error: "no response queued" } };
      rs.writeHead(next.status, { "Content-Type": "application/json" });
      rs.end(JSON.stringify(next.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const client = () => new LlmClient({ baseUrl: url, apiKey: "test-key", model: "deepseek-flash" });

describe("LLM 클라이언트와 카피 작성", () => {
  it("문서 규격대로 요청하고 JSON 초안을 돌려준다", async () => {
    queue = [completion(JSON.stringify(good))];
    const r = await writeCopy(req, client());
    expect(r.draft.image_overlay).toHaveLength(2);
    expect(r.warnings).toEqual([]);
    const sent = seen.at(-1)!;
    expect(sent.auth).toBe("Bearer test-key");
    expect(sent.body.model).toBe("deepseek-flash");
    expect(sent.body.response_format).toEqual({ type: "json_object" });
    expect(JSON.stringify(sent.body.messages)).toContain("json");
  });

  it("빈 내용(JSON 모드에서 공백으로 바뀐 응답)은 한 번 다시 시도한다", async () => {
    queue = [completion("   "), completion(JSON.stringify(good))];
    const before = seen.length;
    const r = await writeCopy(req, client());
    expect(r.draft.sms).toContain("(광고)");
    expect(seen.length - before).toBe(2);
  });

  it("두 번 모두 형식이 틀리면 실패로 알린다", async () => {
    queue = [completion('{"instagram":{}}'), completion("not json")];
    await expect(writeCopy(req, client())).rejects.toThrow();
  });

  it("잔액 부족(402)은 다시 시도하지 않고 사유를 알린다", async () => {
    queue = [{ status: 402, body: { error: { message: "Insufficient Balance" } } }, completion(JSON.stringify(good))];
    const before = seen.length;
    const err = await writeCopy(req, client()).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).message).toContain("잔액");
    expect(seen.length - before).toBe(1);
    queue = [];
  });

  it("길이 제한으로 잘린 응답은 오류다", async () => {
    queue = [completion('{"instagram":', "length")];
    await expect(client().json([{ role: "user", content: "json" }])).rejects.toThrow(/잘렸/);
  });

  it("규칙 검사: 지어낸 번호, 광고 표기 누락, 긴 문구, 입력에 없는 단정 표현을 잡는다", () => {
    const bad: CopyDraft = {
      instagram: { caption: "동네 최고 생강라떼", hashtags: [] },
      image_overlay: ["이 문구는 열두 자를 훌쩍 넘습니다"],
      sms: "온기 생강라떼 5,500원. 문의 010-0000-0000",
    };
    const w = checkCopy(bad, req).join("\n");
    expect(w).toContain("(광고)");
    expect(w).toContain("무료수신거부");
    expect(w).toContain("12자");
    expect(w).toContain("최고");
    expect(w).toContain("010-0000-0000");
  });
});
