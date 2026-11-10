import { z } from "zod";
import { LlmClient, LlmError, llmConfigFromEnv, type LlmUsage } from "./client";

/** 글샘(카피 담당)이 쓰는 입력. 브랜드 기억에서 가져온 값과 이번 소식. */
export interface CopyRequest {
  businessName: string;
  industry: string;
  speechLevel: string;
  voice: string;
  audience?: string;
  doSay?: string;
  dontSay?: string;
  news: string;
}

export const OVERLAY_MAX = 12;
export const SMS_MAX = 90;

const CopySchema = z.object({
  instagram: z.object({ caption: z.string().min(1), hashtags: z.array(z.string().min(1)).max(15) }),
  image_overlay: z.array(z.string().min(1)).min(1).max(5),
  sms: z.string().min(1),
});
export type CopyDraft = z.infer<typeof CopySchema>;

export interface CopyResult {
  draft: CopyDraft;
  /** 사람이 확인해야 할 점. 비어 있어도 발행 전 검토는 필요하다. */
  warnings: string[];
  usage: LlmUsage | null;
  model: string;
}

const SUPERLATIVES = ["최고", "최초", "유일", "1위", "100%", "완벽", "무조건"];

/** 모델 출력에 기대지 않고 코드로 확인하는 규칙. 통과가 법적 적합을 보장하지는 않는다. */
export function checkCopy(draft: CopyDraft, req: Pick<CopyRequest, "news" | "businessName">): string[] {
  const w: string[] = [];
  const source = `${req.businessName} ${req.news}`;
  const all = [draft.instagram.caption, ...draft.image_overlay, draft.sms].join(" ");
  for (const s of draft.image_overlay) if ([...s].length > OVERLAY_MAX) w.push(`이미지 문구 "${s}"가 ${OVERLAY_MAX}자를 넘습니다.`);
  if (!draft.sms.trimStart().startsWith("(광고)")) w.push("문자 맨 앞에 (광고) 표기가 없습니다.");
  if (!draft.sms.includes("무료수신거부") && !draft.sms.includes("무료거부")) w.push("문자에 무료수신거부 안내가 없습니다.");
  if ([...draft.sms].length > SMS_MAX) w.push(`문자가 ${SMS_MAX}자를 넘습니다.`);
  for (const word of SUPERLATIVES) if (all.includes(word) && !source.includes(word)) w.push(`입력에 없는 단정 표현 "${word}"가 들어 있습니다.`);
  // 입력에 없는 숫자(가격, 전화번호, 날짜)는 지어낸 것일 수 있다.
  const known = new Set(source.match(/\d[\d,.-]*\d|\d/g) ?? []);
  const invented = [...new Set(all.match(/\d[\d,.-]*\d|\d/g) ?? [])].filter((n) => !known.has(n));
  if (invented.length) w.push(`입력에 없는 숫자가 있습니다: ${invented.join(", ")}. 수신거부 번호 같은 값은 실제 값으로 바꿔야 합니다.`);
  return w;
}

export function buildCopyMessages(req: CopyRequest) {
  const system = [
    "당신은 한국 소상공인 가게의 마케팅 카피라이터입니다.",
    "입력에 없는 사실(가격, 날짜, 위치, 효능, 전화번호)을 지어내지 않습니다. 수신거부 번호가 입력에 없으면 [수신거부번호]라고 씁니다.",
    "과장 광고와 최상급 표현(최고, 1위 등), 확인되지 않은 효능은 쓰지 않습니다.",
    `image_overlay는 각각 ${OVERLAY_MAX}자 이내, sms는 (광고)로 시작하고 무료수신거부 안내를 넣어 ${SMS_MAX}자 이내로 씁니다.`,
    '반드시 json으로만 답합니다. 형식 예시: {"instagram":{"caption":"...","hashtags":["..."]},"image_overlay":["...","...","..."],"sms":"(광고) ... 무료수신거부 [수신거부번호]"}',
  ].join("\n");
  const user = [
    `가게: ${req.businessName} (${req.industry})`,
    `말투: ${req.speechLevel}, ${req.voice}`,
    req.audience ? `주 고객: ${req.audience}` : "",
    req.doSay ? `꼭 쓸 표현: ${req.doSay}` : "",
    req.dontSay ? `쓰지 않을 표현: ${req.dontSay}` : "",
    `이번 소식: ${req.news}`,
    "인스타그램 캡션 1개(3~4문장)와 해시태그, 이미지 위 문구 3개, 문자 광고 1개를 json으로 써 주세요.",
  ].filter(Boolean).join("\n");
  return [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
}

/** 카피 초안을 만든다. 빈 응답이나 형식 오류는 한 번만 다시 시도한다(문서가 권하는 처리). */
export async function writeCopy(req: CopyRequest, client: LlmClient = new LlmClient(llmConfigFromEnv())): Promise<CopyResult> {
  const messages = buildCopyMessages(req);
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, usage, model } = await client.json(messages);
      const draft = CopySchema.parse(data);
      return { draft, warnings: checkCopy(draft, req), usage, model };
    } catch (e) {
      last = e;
      // 인증, 잔액, 한도 오류는 다시 보내도 같으므로 바로 알린다.
      if (e instanceof LlmError && e.httpStatus !== 200) throw e;
    }
  }
  throw last;
}
