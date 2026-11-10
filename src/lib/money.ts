/** USD 견적을 원화로 바꾼다. 환율은 운영자가 USD_KRW_RATE로 정하며, 1원 단위로 올림한다. */
export function usdToKrw(usd: string, rate: number): number {
  const n = Number(usd);
  if (!Number.isFinite(n) || n < 0) throw new Error(`견적 금액을 읽을 수 없습니다: ${usd}`);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("USD_KRW_RATE가 올바르지 않습니다");
  // 부동소수 오차를 피하려고 마이크로달러 정수로 계산한다.
  const micro = Math.round(n * 1_000_000);
  return Math.ceil(Math.round(micro * rate) / 1_000_000);
}

export function rateFromEnv(): number {
  const r = Number(process.env.USD_KRW_RATE);
  if (!Number.isFinite(r) || r <= 0) throw new Error("USD_KRW_RATE 환경 변수가 필요합니다");
  return r;
}
