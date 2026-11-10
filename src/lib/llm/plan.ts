import { z } from "zod";
import type { LlmClient } from "./client";
import { CHANNELS } from "@/lib/briefs";

/** 한결(팀장)이 요청 한 줄을 읽고 정하는 일 나누기. */
const PlanSchema = z.object({
  reply: z.string().min(1),
  title: z.string().min(1),
  copy: z.boolean(),
  image: z.boolean(),
  video: z.boolean(),
  variants: z.number().int().min(1).max(3).catch(1),
  channel: z.string(),
  image_prompt_en: z.string().catch(""),
  video_prompt_en: z.string().catch(""),
  news: z.string().catch(""),
});
export type MissionPlan = z.infer<typeof PlanSchema>;

export interface PlanBrand { businessName: string; industry: string; voice: string; audience: string; offers: string }

export async function planMission(prompt: string, brand: PlanBrand, llm: LlmClient): Promise<MissionPlan> {
  const system = [
    "당신은 한국 소상공인 가게 마케팅팀의 팀장 '한결'입니다. 사장님의 요청 한 줄을 읽고 팀원에게 일을 나눕니다.",
    "팀원은 두 명뿐입니다. 글샘: 인스타그램 캡션, 이미지 위 문구, 문자 광고 초안을 씁니다. 빛나: 이미지 시안을 만들고, 그 이미지로 5초 영상을 만들 수 있습니다.",
    "게시 예약, 성과 분석, 웹 검색은 아직 할 수 없습니다. 할 수 없는 일을 요청받으면 copy, image, video를 모두 false로 하고 reply에서 지금 할 수 있는 일을 알려 줍니다.",
    "요청에 맞는 일만 고릅니다. 홍보물이나 게시물을 통째로 요청하면 copy와 image를 함께 고릅니다. video는 사장님이 영상을 요청했을 때만 true로 하며, 그때는 image도 true여야 합니다.",
    "image_prompt_en: 이미지 생성 모델에 줄 영어 프롬프트. 사진의 피사체, 온도감(뜨거운지 차가운지), 그릇, 배경, 조명, 구도를 구체적으로 씁니다. 이미지 안에 글자를 넣으라고 하지 않습니다. 입력에 없는 브랜드 로고나 사람은 넣지 않습니다.",
    "video_prompt_en: 그 이미지에서 시작하는 5초 영상의 움직임을 영어 한 문장으로 씁니다.",
    "news: 글샘에게 넘길 사실 요약(한국어). 요청과 가게 정보에 있는 사실만 쓰고 지어내지 않습니다.",
    `channel은 다음 중 하나입니다: ${CHANNELS.map((c) => `${c.key}(${c.label})`).join(", ")}. 말이 없으면 insta-feed.`,
    "variants는 이미지 시안 개수(1~3)이며 말이 없으면 1입니다. reply는 사장님께 드리는 존댓말 한 문장, title은 12자 이내 제목입니다.",
    '반드시 json으로만 답합니다. 형식 예시: {"reply":"...","title":"...","copy":true,"image":true,"video":false,"variants":1,"channel":"insta-feed","image_prompt_en":"...","video_prompt_en":"","news":"..."}',
  ].join("\n");
  const user = `가게: ${brand.businessName} (${brand.industry})\n말투: ${brand.voice}\n주 고객: ${brand.audience}\n가게 소개: ${brand.offers}\n\n사장님 요청: ${prompt}`;
  const { data } = await llm.json([{ role: "system", content: system }, { role: "user", content: user }], { maxTokens: 900 });
  const plan = PlanSchema.parse(data);
  if (!CHANNELS.some((c) => c.key === plan.channel)) plan.channel = "insta-feed";
  if (plan.video && !plan.image) plan.image = true;
  if (plan.image && !plan.image_prompt_en.trim()) plan.image_prompt_en = prompt;
  return plan;
}
