// 사무실에서 일어나는 일의 기록 형식. 서버가 실제로 한 일만 기록하고, 화면과 다시보기는 이 기록만 재생한다.
// 기본 형식은 가져온 사무실 엔진(src/vendor/bureau)의 OfficeEvent이고, 트레이딩 데스크 결과 전달용 형식을 더했다.
import type { OfficeEvent, Role } from "@/vendor/bureau/shared/protocol";
import type { BtStats } from "@/lib/trading/backtest";
import type { Headline } from "@/lib/trading/news";

export interface BacktestRow { key: string; name: string; rule: string; train: BtStats; verify: BtStats; passed: boolean; why: string }
export interface OrderView { id: string; coin: string; side: "long" | "short"; qty: number; entry: number; stop: number; target: number; strategy: string }

export type DeskEvent =
  | { k: "backtest"; who: string; coin: string; interval: string; bars: number; from: number; to: number; splitAt: number; rows: BacktestRow[]; chosen: string | null; costs: string }
  | { k: "news"; who: string; items: Headline[]; failed: string[]; stance: "risk_off" | "neutral" | "supportive" | null; summary: string; used: number[]; model: string | null }
  | { k: "timing"; who: string; strategy: string | null; barAt: number; close: number; price: number | null; signal: { side: "long" | "short"; entry: number; stop: number; target: number } | null; note: string }
  | { k: "order"; who: string; ok: boolean; text: string; trade?: OrderView };

export type MEvent = OfficeEvent | DeskEvent;
export const DESK_KINDS = new Set(["backtest", "news", "timing", "order"]);
export const isDeskEvent = (ev: MEvent): ev is DeskEvent => DESK_KINDS.has(ev.k);
export interface MLogged { seq: number; at: number; ev: MEvent }

/** 지금 실제로 일하는 직원. 사무실 엔진의 자리(역할)와 연결한다. */
export const STAFF: Record<string, { name: string; title: string; role: Role; what: string }> = {
  chef: { name: "한결", title: "팀장", role: "chef", what: "요청을 읽고 볼 종목과 시간축을 정합니다 (LLM)" },
  seojun: { name: "서준", title: "전략 연구원", role: "analyse", what: "정해진 규칙 전략 3개를 수수료를 넣어 백테스트하고, 학습·검증 구간 모두 이익인 전략만 고릅니다" },
  harin: { name: "하린", title: "뉴스 분석가", role: "recherche", what: "최근 24시간 헤드라인을 모아 위험 신호를 봅니다. 진입을 막을 수만 있고 만들지는 못합니다 (LLM)" },
  jiho: { name: "지호", title: "진입 타이밍 분석가", role: "code", what: "방금 마감한 봉에서 고른 전략의 진입 신호가 났는지 확인합니다" },
  daon: { name: "다온", title: "리스크·매매 담당", role: "design", what: "1회 위험, 일일 손실 한도, 레버리지 상한을 확인한 뒤 모의 계좌에 주문합니다" },
};

export interface MissionView {
  id: string;
  title: string;
  prompt: string;
  status: string;
  createdAt: number;
  endedAt: number | null;
}
