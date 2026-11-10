// 한글 문구 합성. 이미지 모델이 한글을 정확히 그린다는 보장을 확인하지 못했기 때문에
// 글자는 모델에 맡기지 않고 앱이 직접 그린다.

export interface OverlaySpec {
  headline: string;
  sub: string;
  position: "top" | "middle" | "bottom";
  textColor: string;
  bandColor: string;
  band: boolean;
  virtualPerson: boolean;
}

export const VIRTUAL_PERSON_LABEL = "가상인물";
const FONT = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

/** 한국어는 띄어쓰기 단위로 줄을 바꾸되, 한 단어가 너무 길면 글자 단위로 나눈다. */
export function wrapText(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= maxWidth) { line = next; continue; }
      if (line) lines.push(line);
      line = "";
      let chunk = "";
      for (const ch of word) {
        if (measure(chunk + ch) > maxWidth && chunk) { lines.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    if (line) lines.push(line);
  }
  return lines;
}

export function drawOverlay(c: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, spec: OverlaySpec) {
  c.clearRect(0, 0, w, h);
  c.drawImage(img, 0, 0, w, h);
  const pad = Math.round(w * 0.06);
  const headSize = Math.round(w * 0.085);
  const subSize = Math.round(w * 0.045);
  const maxW = w - pad * 2;

  c.textBaseline = "top";
  c.font = `700 ${headSize}px ${FONT}`;
  const head = spec.headline.trim() ? wrapText((s) => c.measureText(s).width, spec.headline.trim(), maxW) : [];
  c.font = `400 ${subSize}px ${FONT}`;
  const sub = spec.sub.trim() ? wrapText((s) => c.measureText(s).width, spec.sub.trim(), maxW) : [];

  if (head.length + sub.length > 0) {
    const headH = head.length * headSize * 1.25;
    const gap = head.length && sub.length ? subSize * 0.6 : 0;
    const subH = sub.length * subSize * 1.4;
    const blockH = headH + gap + subH + pad * 1.2;
    const y0 = spec.position === "top" ? 0 : spec.position === "middle" ? (h - blockH) / 2 : h - blockH;
    if (spec.band) {
      c.globalAlpha = 0.88;
      c.fillStyle = spec.bandColor;
      c.fillRect(0, y0, w, blockH);
      c.globalAlpha = 1;
    }
    c.fillStyle = spec.textColor;
    if (!spec.band) { c.shadowColor = "rgba(0,0,0,0.55)"; c.shadowBlur = headSize * 0.25; }
    let y = y0 + pad * 0.6;
    c.font = `700 ${headSize}px ${FONT}`;
    for (const l of head) { c.fillText(l, pad, y); y += headSize * 1.25; }
    y += gap;
    c.font = `400 ${subSize}px ${FONT}`;
    for (const l of sub) { c.fillText(l, pad, y); y += subSize * 1.4; }
    c.shadowColor = "transparent";
    c.shadowBlur = 0;
  }

  if (spec.virtualPerson) {
    // 공정위 추천·보증 심사지침(2026-06-01 시행): 사진·영상은 가상인물 인근에 '가상인물' 표시.
    // 인물 위치를 자동으로 찾지는 못하므로 눈에 띄는 모서리에 넣고, 위치 확인은 사용자에게 맡긴다.
    const size = Math.round(w * 0.04);
    c.font = `700 ${size}px ${FONT}`;
    const tw = c.measureText(VIRTUAL_PERSON_LABEL).width;
    const bx = w - tw - size * 1.6;
    const by = spec.position === "top" && head.length + sub.length > 0 ? h - size * 2.6 : size * 0.8;
    c.fillStyle = "rgba(0,0,0,0.72)";
    c.fillRect(bx, by, tw + size * 0.9, size * 1.7);
    c.fillStyle = "#ffffff";
    c.fillText(VIRTUAL_PERSON_LABEL, bx + size * 0.45, by + size * 0.35);
  }
}
