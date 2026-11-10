// 픽셀 그림은 전부 이 파일의 코드로 그린다. 외부 이미지나 다른 프로젝트의 그림을 쓰지 않는다.
import type { Member } from "@/lib/team";
type Mood = "working" | "waiting" | "done" | "idle" | "soon";

export const OFFICE_W = 256;
export const OFFICE_H = 168;

type Ctx = CanvasRenderingContext2D;
const px = (c: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), w, h);
};

/** 캐릭터 한 명 (12×18). (x, y)는 왼쪽 위. frame은 0 또는 1. */
export function drawPerson(c: Ctx, x: number, y: number, look: Member["look"], opts: { frame?: number; typing?: boolean; dim?: boolean; seated?: boolean } = {}) {
  const f = opts.frame ?? 0;
  const bob = opts.typing ? 0 : f; // 쉬는 중에는 살짝 들썩인다
  const yy = y + bob;
  c.save();
  if (opts.dim) c.globalAlpha = 0.45;
  // 머리카락
  px(c, x + 2, yy, 8, 3, look.hair);
  px(c, x + 1, yy + 1, 10, 3, look.hair);
  if (look.hairStyle === "bob") { px(c, x + 1, yy + 4, 2, 4, look.hair); px(c, x + 9, yy + 4, 2, 4, look.hair); }
  if (look.hairStyle === "long") { px(c, x + 1, yy + 4, 2, 7, look.hair); px(c, x + 9, yy + 4, 2, 7, look.hair); }
  if (look.hairStyle === "bun") px(c, x + 4, yy - 2, 4, 2, look.hair);
  if (look.hairStyle === "cap") { px(c, x + 1, yy, 10, 3, look.accent); px(c, x + 8, yy + 3, 5, 1, look.accent); }
  // 얼굴
  px(c, x + 3, yy + 3, 6, 5, look.skin);
  px(c, x + 4, yy + 5, 1, 1, "#2a2230");
  px(c, x + 7, yy + 5, 1, 1, "#2a2230");
  // 몸
  px(c, x + 2, yy + 8, 8, 6, look.top);
  px(c, x + 5, yy + 8, 2, 2, look.accent);
  // 팔
  if (opts.typing) {
    px(c, x + (f ? 0 : 1), yy + 10, 2, 2, look.skin);
    px(c, x + (f ? 10 : 9), yy + 10, 2, 2, look.skin);
  } else {
    px(c, x + 1, yy + 9, 1, 4, look.top);
    px(c, x + 10, yy + 9, 1, 4, look.top);
  }
  // 다리
  if (!opts.seated) {
    px(c, x + 3, y + 14 + bob, 2, 4 - bob, "#33384a");
    px(c, x + 7, y + 14 + bob, 2, 4 - bob, "#33384a");
  }
  c.restore();
}

function drawDesk(c: Ctx, x: number, y: number, mood: Mood, frame: number, accent: string) {
  // 책상
  px(c, x - 8, y + 14, 28, 9, "#b98a5e");
  px(c, x - 8, y + 23, 28, 2, "#8f6843");
  px(c, x - 7, y + 25, 2, 5, "#8f6843");
  px(c, x + 17, y + 25, 2, 5, "#8f6843");
  // 모니터
  px(c, x - 1, y + 7, 14, 9, "#2a2f3d");
  const on = mood === "working" || mood === "waiting" || mood === "done";
  px(c, x, y + 8, 12, 7, on ? (mood === "working" && frame ? "#bff3df" : mood === "waiting" ? "#ffe9a8" : "#9fe3c5") : "#454b5c");
  if (mood === "working") for (let i = 0; i < 3; i++) px(c, x + 1, y + 9 + i * 2, 4 + ((i + frame) % 3) * 2, 1, "#1f8a68");
  if (mood === "done") { px(c, x + 3, y + 11, 2, 2, "#1f8a68"); px(c, x + 5, y + 12, 2, 2, "#1f8a68"); px(c, x + 7, y + 9, 2, 3, "#1f8a68"); }
  px(c, x + 5, y + 16, 2, 1, "#2a2f3d");
  // 책상 위 소품
  px(c, x - 6, y + 16, 3, 3, accent);
}

export function drawOffice(c: Ctx, team: Member[], moods: Record<string, Mood>, frame: number, selected?: string) {
  // 벽과 바닥
  px(c, 0, 0, OFFICE_W, 44, "#f3e7d3");
  px(c, 0, 40, OFFICE_W, 4, "#d9c6a5");
  px(c, 0, 44, OFFICE_W, OFFICE_H - 44, "#e9d9bd");
  for (let y = 44; y < OFFICE_H; y += 12) for (let x = (y / 12) % 2 ? 0 : 12; x < OFFICE_W; x += 24) px(c, x, y, 12, 12, "#e2cfae");
  // 창문 두 개와 해
  for (const wx of [20, 96]) {
    px(c, wx, 8, 44, 24, "#8f6843");
    px(c, wx + 2, 10, 40, 20, "#bfe6f5");
    px(c, wx + 21, 10, 2, 20, "#8f6843");
    px(c, wx + 2, 19, 40, 2, "#8f6843");
  }
  px(c, 28, 13, 6, 6, "#ffd866");
  // 일정 게시판
  px(c, 166, 8, 46, 26, "#8f6843");
  px(c, 168, 10, 42, 22, "#fffaf0");
  const notes = ["#ffb3b3", "#bfe6f5", "#ffe08a", "#c9efc0", "#e0c9f5", "#ffd0a8"];
  notes.forEach((col, i) => px(c, 171 + (i % 3) * 13, 13 + Math.floor(i / 3) * 9, 10, 6, col));
  // 문
  px(c, 224, 10, 20, 34, "#a9794f");
  px(c, 226, 12, 16, 32, "#c4925f");
  px(c, 238, 28, 2, 2, "#f2d04b");
  // 화분
  px(c, 204, 132, 10, 8, "#c4704a");
  px(c, 203, 122, 12, 10, "#3f9b6a");
  px(c, 206, 117, 6, 6, "#4fb37c");
  // 휴게 탁자
  px(c, 178, 86, 30, 12, "#d7b48a");
  px(c, 178, 98, 30, 2, "#8f6843");
  px(c, 186, 82, 5, 5, "#ffffff");
  px(c, 196, 83, 4, 4, "#c95f7b");

  for (const m of team) {
    const mood = moods[m.key] ?? "idle";
    const { x, y } = m.desk;
    if (selected === m.key) {
      c.strokeStyle = "#1f8a68";
      c.lineWidth = 1;
      c.strokeRect(x - 11.5, y - 4.5, 35, 37);
    }
    drawPerson(c, x, y, m.look, { frame, typing: mood === "working", dim: mood === "soon", seated: true });
    drawDesk(c, x, y, mood, frame, m.look.accent);
  }
}
