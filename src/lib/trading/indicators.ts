// 지표. 모두 앞에서부터 계산하며, 값이 아직 없으면 NaN이다.

export function sma(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function ema(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  if (x.length < n) return out;
  const k = 2 / (n + 1);
  let v = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = v;
  for (let i = n; i < x.length; i++) { v = x[i] * k + v * (1 - k); out[i] = v; }
  return out;
}

/** Wilder 방식 RSI */
export function rsi(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  if (x.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = x[i] - x[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < x.length; i++) {
    const d = x[i] - x[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

/** Wilder 방식 ATR */
export function atr(h: number[], l: number[], c: number[], n: number): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  const tr = c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  if (c.length < n) return out;
  let v = tr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = v;
  for (let i = n; i < c.length; i++) { v = (v * (n - 1) + tr[i]) / n; out[i] = v; }
  return out;
}

/** i번째 봉 직전 n개 봉의 최고가(현재 봉 제외) */
export function priorHigh(h: number[], i: number, n: number): number {
  if (i < n) return NaN;
  let m = -Infinity;
  for (let j = i - n; j < i; j++) m = Math.max(m, h[j]);
  return m;
}
export function priorLow(l: number[], i: number, n: number): number {
  if (i < n) return NaN;
  let m = Infinity;
  for (let j = i - n; j < i; j++) m = Math.min(m, l[j]);
  return m;
}
