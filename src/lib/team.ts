// AI 직원 다섯 명. 이름, 역할, 생김새 모두 이 프로젝트에서 새로 만든 것이다.
export type MemberKey = "hangyeol" | "geulsaem" | "bitna" | "naru" | "sem";

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
    title: "기획 담당",
    mission: "이번 달 무엇을 올릴지 정합니다",
    line: "설, 추석, 빼빼로데이까지. 가게 달력은 제가 챙길게요.",
    duties: ["월간 콘텐츠 계획", "국내 시즌과 업종 반영", "다른 직원에게 일 나누기"],
    active: false,
    look: { hair: "#2b2b3a", skin: "#f1c9a5", top: "#3f6fb5", accent: "#f2d04b", hairStyle: "short" },
    desk: { x: 28, y: 62 },
  },
  {
    key: "geulsaem",
    name: "글샘",
    title: "카피 담당",
    mission: "사장님 말투로 글을 씁니다",
    line: "인스타 캡션, 블로그 원고, 카카오 메시지. 말투는 사장님 그대로 갈게요.",
    duties: ["인스타 캡션과 블로그 원고", "카카오 메시지와 상세페이지 문구", "존댓말·반말, 금지어 지키기"],
    active: false,
    look: { hair: "#7a4a2b", skin: "#f6d3b3", top: "#c95f7b", accent: "#ffffff", hairStyle: "bob" },
    desk: { x: 88, y: 62 },
  },
  {
    key: "bitna",
    name: "빛나",
    title: "크리에이티브 담당",
    mission: "이미지와 영상을 만듭니다",
    line: "브랜드 색은 제가 지켜요. 만들기 전에 비용부터 보여 드릴게요.",
    duties: ["이미지와 광고 시안 제작", "짧은 영상 제작", "예상 비용을 먼저 보여 주고 승인 후 제작"],
    active: true,
    look: { hair: "#e8a23a", skin: "#f3ccab", top: "#1f8a68", accent: "#ffe08a", hairStyle: "bun" },
    desk: { x: 148, y: 62 },
  },
  {
    key: "naru",
    name: "나루",
    title: "채널 담당",
    mission: "올리기 전에 규정을 확인합니다",
    line: "(광고) 표기, 가상인물 표시, 밤 9시 이후 발송. 걸리는 건 제가 먼저 잡아요.",
    duties: ["채널별 게시 패키지 조립", "승인 대기열과 예약", "광고 표기와 발송 시간 규정 검사"],
    active: false,
    look: { hair: "#1d3b4f", skin: "#e9bd97", top: "#e07b39", accent: "#1d3b4f", hairStyle: "cap" },
    desk: { x: 58, y: 118 },
  },
  {
    key: "sem",
    name: "셈",
    title: "분석 담당",
    mission: "무엇이 통했는지 숫자로 봅니다",
    line: "잘된 게시물을 찾아서 다음에 더 만들 걸 알려 드릴게요.",
    duties: ["성과 자료 읽기", "잘된 콘텐츠 찾기", "다음에 만들 것 추천"],
    active: false,
    look: { hair: "#5b4a8a", skin: "#f4cfae", top: "#6b6f7a", accent: "#9fe3c5", hairStyle: "long" },
    desk: { x: 118, y: 118 },
  },
];

export const getMember = (key: string) => TEAM.find((m) => m.key === key);
