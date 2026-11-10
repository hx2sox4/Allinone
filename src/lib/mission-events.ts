// 사무실에서 일어나는 일의 기록 형식. 서버가 실제로 한 일만 기록하고, 화면과 다시보기는 이 기록만 재생한다.
// 기본 형식은 가져온 사무실 엔진(src/vendor/bureau)의 OfficeEvent이고, 문구 초안 전달용 한 가지를 더했다.
import type { OfficeEvent, Role } from "@/vendor/bureau/shared/protocol";
import type { CopyDraft } from "@/lib/llm/copy";

export type MEvent = OfficeEvent | { k: "copy"; who: string; draft: CopyDraft; warnings: string[]; model: string };
export interface MLogged { seq: number; at: number; ev: MEvent }

/** 지금 실제로 일하는 직원. 사무실 엔진의 자리(역할)와 연결한다. */
export const STAFF: Record<string, { name: string; title: string; role: Role; what: string }> = {
  chef: { name: "한결", title: "팀장", role: "chef", what: "요청을 읽고 할 일을 나눕니다 (DeepSeek)" },
  geulsaem: { name: "글샘", title: "문구 담당", role: "redaction", what: "인스타그램 캡션, 이미지 문구, 문자 초안을 씁니다 (DeepSeek)" },
  bitna: { name: "빛나", title: "이미지·영상 담당", role: "design", what: "이미지와 영상을 만듭니다 (Higgsfield). 비용을 먼저 보여 주고 승인 후 만듭니다" },
};

export interface MissionView {
  id: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: number;
  endedAt: number | null;
}
