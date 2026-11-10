import { z } from "zod";
import type { LlmClient } from "./client";
import { COINS, TRADE_INTERVALS, type Interval } from "@/lib/market/hyperliquid";
import type { Headline } from "@/lib/trading/news";

/** 한결(팀장)이 요청 한 줄을 읽고 정하는 일. 숫자 판단은 하지 않고, 무엇을 볼지만 정한다. */
const PlanSchema = z.object({
  reply: z.string().min(1),
  title: z.string().min(1),
  coin: z.string(),
  interval: z.string(),
  mode: z.enum(["trade", "analyze", "none"]).catch("analyze"),
});
export interface DeskPlan { reply: string; title: string; coin: string; interval: Interval; mode: "trade" | "analyze" | "none" }

export async function planDesk(prompt: string, llm: LlmClient): Promise<DeskPlan> {
  const coins = Object.entries(COINS).map(([k, v]) => `${k}(${v.label})`).join(", ");
  const system = [
    "당신은 모의매매 트레이딩 회사의 팀장 '한결'입니다. 사용자의 요청 한 줄을 읽고 팀이 할 일을 정합니다.",
    "팀원: 서준(전략 연구원, 정해진 규칙 전략을 백테스트), 하린(뉴스 분석가, 최근 헤드라인 확인), 지호(진입 타이밍 분석가, 방금 마감한 봉에서 신호 확인), 다온(리스크 관리·매매 담당, 모의 계좌에 주문).",
    "이 회사는 모의매매만 합니다. 실제 돈이나 실제 거래소 주문은 없습니다. 수익을 약속하거나 가격을 예측하지 않습니다.",
    `coin은 다음 중 하나입니다: ${coins}. 말이 없으면 BTC.`,
    `interval은 ${TRADE_INTERVALS.join(", ")} 중 하나입니다. 말이 없으면 4h. 단타·스캘핑이면 15m, 스윙이면 4h 또는 1d.`,
    "mode: 조건이 맞으면 모의 주문까지 하라는 뜻이면 trade, 분석만 원하면 analyze, 트레이딩과 상관없는 요청이면 none.",
    "reply는 사용자에게 드리는 존댓말 한 문장, title은 12자 이내 제목입니다.",
    '반드시 json으로만 답합니다. 형식 예시: {"reply":"...","title":"BTC 4시간 점검","coin":"BTC","interval":"4h","mode":"trade"}',
  ].join("\n");
  const { data } = await llm.json([{ role: "system", content: system }, { role: "user", content: prompt }], { maxTokens: 400 });
  const p = PlanSchema.parse(data);
  const coin = COINS[p.coin] ? p.coin : Object.keys(COINS).find((k) => k.toLowerCase() === p.coin.toLowerCase()) ?? "BTC";
  const interval = (TRADE_INTERVALS as string[]).includes(p.interval) ? (p.interval as Interval) : "4h";
  return { reply: p.reply, title: p.title.slice(0, 40), coin, interval, mode: p.mode };
}

const NewsSchema = z.object({
  stance: z.enum(["risk_off", "neutral", "supportive"]).catch("neutral"),
  summary: z.string().catch(""),
  used: z.array(z.number().int()).catch([]),
});
export type NewsView = z.infer<typeof NewsSchema>;

/** 하린(뉴스 분석가). 주어진 헤드라인만 근거로 쓴다. 결과는 진입을 막을 수만 있고, 진입을 만들지는 못한다. */
export async function judgeNews(coinLabel: string, items: Headline[], llm: LlmClient): Promise<NewsView & { model: string }> {
  const system = [
    "당신은 트레이딩 회사의 뉴스 분석가 '하린'입니다. 아래 번호 붙은 헤드라인만 근거로 씁니다. 헤드라인에 없는 사실, 가격, 수치를 지어내지 않습니다.",
    "stance: 거래소 해킹·파산, 해당 자산의 거래 금지나 상장폐지, 시장 전체 급락을 부를 만한 돌발 사건이 헤드라인에 분명히 있으면 risk_off. 뚜렷한 호재만 있으면 supportive. 그 밖에는 neutral.",
    "summary: 한국어 2~3문장. 어떤 헤드라인 때문에 그렇게 봤는지 번호로 밝힙니다. used: 근거로 쓴 헤드라인 번호 목록.",
    '반드시 json으로만 답합니다. 형식 예시: {"stance":"neutral","summary":"...","used":[1,3]}',
  ].join("\n");
  const user = `자산: ${coinLabel}\n헤드라인:\n${items.map((h, i) => `${i + 1}. [${new Date(h.at).toISOString().slice(0, 16)}Z ${h.source}] ${h.title}`).join("\n")}`;
  const { data, model } = await llm.json([{ role: "system", content: system }, { role: "user", content: user }], { maxTokens: 500 });
  const v = NewsSchema.parse(data);
  v.used = v.used.filter((n) => n >= 1 && n <= items.length);
  return { ...v, model };
}
