// AI 직원 다섯 명(트레이딩 데스크). 이름, 역할, 생김새 모두 이 프로젝트에서 새로 만든 것이다.
export type MemberKey = "hangyeol" | "seojun" | "harin" | "jiho" | "daon";

export interface Member {
  key: MemberKey;
  name: string;
  title: string;
  /** 인트로에서 보여 주는 임무 한 줄 */
  mission: string;
  /** 인트로 대사 */
  line: string;
  duties: string[];
  /** 지금 실제로 일할 수 있는지. false면 다음 단계에서 합류한다고 화면에 밝힌다. */
  active: boolean;
  look: { hair: string; skin: string; top: string; accent: string; hairStyle: "short" | "bob" | "long" | "cap" | "bun" };
  /** 사무실 안 책상 위치 (픽셀 좌표, 캔버스 256×168 기준) */
  desk: { x: number; y: number };
}

export const TEAM: Member[] = [
  {
    key: "hangyeol",
    name: "한결",
    title: "팀장",
    mission: "무엇을 볼지 정하고 팀에 나눕니다",
    line: "종목과 시간축만 말씀해 주세요. 나머지는 팀이 순서대로 확인합니다.",
    duties: ["요청에서 종목과 시간축 정하기", "분석만 할지, 조건이 맞으면 모의 주문까지 할지 정하기", "마지막에 결과 정리"],
    active: true,
    look: { hair: "#2b2b3a", skin: "#f1c9a5", top: "#3f6fb5", accent: "#f2d04b", hairStyle: "short" },
    desk: { x: 28, y: 62 },
  },
  {
    key: "seojun",
    name: "서준",
    title: "전략 연구원",
    mission: "백테스트를 통과한 전략만 씁니다",
    line: "수수료까지 넣고 학습·검증 두 구간에서 모두 남는 전략만 올릴게요. 없으면 없다고 말씀드립니다.",
    duties: ["정해진 규칙 전략 3개 백테스트", "Propr 수수료와 슬리피지 반영", "학습·검증 구간 모두 이익인 전략만 선택"],
    active: true,
    look: { hair: "#7a4a2b", skin: "#f6d3b3", top: "#c95f7b", accent: "#ffffff", hairStyle: "bob" },
    desk: { x: 88, y: 62 },
  },
  {
    key: "harin",
    name: "하린",
    title: "뉴스 분석가",
    mission: "돌발 악재가 있으면 진입을 막습니다",
    line: "헤드라인에 있는 것만 말해요. 뉴스로 진입을 만들지는 않고, 위험할 때 멈추게만 합니다.",
    duties: ["최근 24시간 RSS 헤드라인 수집", "해킹·금지·급락 같은 위험 신호 확인", "근거 헤드라인 번호 밝히기"],
    active: true,
    look: { hair: "#e8a23a", skin: "#f3ccab", top: "#1f8a68", accent: "#ffe08a", hairStyle: "bun" },
    desk: { x: 148, y: 62 },
  },
  {
    key: "jiho",
    name: "지호",
    title: "진입 타이밍 분석가",
    mission: "방금 마감한 봉에서 신호를 봅니다",
    line: "봉이 마감하기 전에는 판단하지 않아요. 신호가 없으면 기다립니다.",
    duties: ["마감한 봉에서 고른 전략의 신호 확인", "현재가로 손절·목표 다시 계산", "이미 손절가를 넘었으면 진입 취소"],
    active: true,
    look: { hair: "#1d3b4f", skin: "#e9bd97", top: "#e07b39", accent: "#1d3b4f", hairStyle: "cap" },
    desk: { x: 58, y: 118 },
  },
  {
    key: "daon",
    name: "다온",
    title: "리스크·매매 담당",
    mission: "규칙을 통과해야만 주문합니다",
    line: "1회 위험 0.5%, 하루 손실 1.5%가 기본이에요. 한도에 닿으면 그날은 더 사지 않습니다.",
    duties: ["1회 위험으로 수량 계산", "일일 손실 한도와 레버리지 상한 확인", "모의 계좌에 주문하고 손절·목표 관리"],
    active: true,
    look: { hair: "#5b4a8a", skin: "#f4cfae", top: "#6b6f7a", accent: "#9fe3c5", hairStyle: "long" },
    desk: { x: 118, y: 118 },
  },
];

export const getMember = (key: string) => TEAM.find((m) => m.key === key);
