// 글쓰기용 LLM 클라이언트. 서버에서만 불러와야 한다.
// OpenAI 호환 chat/completions 형식만 쓴다. 기본 제공자는 DeepSeek이다.
// 규격 출처(2026-11-10 확인): https://api-docs.deepseek.com/ , /api/create-chat-completion , /guides/json_mode , /quick_start/error_codes
// 모델 이름은 같은 날 GET /models 실제 응답으로 확인했다: deepseek-flash, deepseek-v4-pro.

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export class LlmError extends Error {
  constructor(public httpStatus: number, public body: string, message?: string) {
    super(message ?? `LLM 응답 오류 ${httpStatus}: ${body.slice(0, 300)}`);
  }
}

/** DeepSeek 문서의 오류 코드 표를 사용자에게 보여 줄 말로 바꾼다. */
export function explainLlmError(status: number): string {
  if (status === 401) return "LLM API 키가 올바르지 않습니다.";
  if (status === 402) return "LLM 계정 잔액이 부족합니다. 충전한 뒤 다시 시도해 주세요.";
  if (status === 429) return "요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.";
  if (status === 500 || status === 503) return "LLM 서버가 일시적으로 응답하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";
  return "글쓰기 요청이 거절됐습니다.";
}

export function llmConfigFromEnv(): LlmConfig {
  const apiKey = process.env.LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("LLM_API_KEY(또는 DEEPSEEK_API_KEY) 환경 변수가 필요합니다");
  return {
    baseUrl: (process.env.LLM_API_BASE ?? "https://api.deepseek.com").replace(/\/$/, ""),
    apiKey,
    model: process.env.LLM_MODEL ?? "deepseek-flash",
  };
}

export class LlmClient {
  private fetchImpl: typeof fetch;
  constructor(private cfg: LlmConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  /**
   * JSON 한 덩어리를 받는다. 문서에 따르면 JSON 모드에서는 프롬프트에 "json"이라는 말과 예시가 있어야 하고,
   * 결과가 올바른 JSON이 아니면 내용이 공백으로 바뀌어 올 수 있다. 그래서 빈 내용과 잘린 내용을 오류로 다룬다.
   */
  async json(messages: LlmMessage[], opts: { maxTokens?: number } = {}): Promise<{ data: unknown; usage: LlmUsage | null; model: string }> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        max_tokens: opts.maxTokens ?? 1200,
        response_format: { type: "json_object" },
        // 짧은 카피 작성에는 추론 단계를 끈다. 켜면 추론 토큰만큼 비용과 시간이 더 든다.
        thinking: { type: "disabled" },
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new LlmError(res.status, text, explainLlmError(res.status));
    const body = JSON.parse(text) as { model?: string; usage?: LlmUsage; choices?: { finish_reason?: string; message?: { content?: string | null } }[] };
    const choice = body.choices?.[0];
    const content = choice?.message?.content ?? "";
    if (choice?.finish_reason === "length") throw new LlmError(200, text, "글이 길이 제한에 걸려 잘렸습니다.");
    if (!content.trim()) throw new LlmError(200, text, "LLM이 빈 내용을 돌려줬습니다.");
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      throw new LlmError(200, content, "LLM 응답이 JSON 형식이 아닙니다.");
    }
    return { data, usage: body.usage ?? null, model: body.model ?? this.cfg.model };
  }
}
