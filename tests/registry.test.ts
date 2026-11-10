import { describe, expect, it } from "vitest";
import raw from "@/lib/higgsfield/models.json";
import { MODELS, parseRegistry, validateInput } from "@/lib/higgsfield/registry";
import { usdToKrw } from "@/lib/money";

describe("모델 레지스트리", () => {
  it("모든 항목이 형식에 맞고 문서 주소를 가진다", () => {
    expect(MODELS.length).toBe(5);
    for (const m of MODELS) expect(m.docUrl.startsWith("https://docs.higgsfield.ai/docs/models/")).toBe(true);
  });
  it("키가 중복되면 거부한다", () => {
    expect(() => parseRegistry({ models: [raw.models[0], raw.models[0]] })).toThrow(/중복/);
  });
  it("알 수 없는 필드 형식은 거부한다", () => {
    const bad = { ...raw.models[0], fields: { prompt: { type: "text" } } };
    expect(() => parseRegistry({ models: [bad] })).toThrow();
  });
  it("모델이 지원하지 않는 화면비는 거부한다 (Z-Image Turbo에는 4:5가 없다)", () => {
    expect(() => validateInput("z-image-turbo", { prompt: "카페", aspect_ratio: "4:5" })).toThrow();
    expect(validateInput("ads-studio", { prompt: "카페", aspect_ratio: "4:5" })).toEqual({ prompt: "카페", aspect_ratio: "4:5" });
  });
  it("스키마에 없는 필드는 거부한다", () => {
    expect(() => validateInput("z-image-turbo", { prompt: "카페", style: "anime" })).toThrow();
  });
  it("필수 필드가 없으면 거부한다", () => {
    expect(() => validateInput("kling-2-5-turbo-i2v", { prompt: "천천히 회전" })).toThrow();
  });
  it("허용 값과 범위를 지킨다", () => {
    expect(() => validateInput("kling-2-5-turbo-i2v", { prompt: "p", image_url: "https://a/b.png", duration: 7 })).toThrow();
    expect(() => validateInput("ads-studio", { prompt: "p", batch_size: 9 })).toThrow();
    expect(() => validateInput("recraft-v4-1", { prompt: "p", colors: [{ rgb: [0, 0, 0] }] })).toThrow();
    expect(() => validateInput("z-image-turbo", { prompt: "가".repeat(801) })).toThrow();
  });
  it("레지스트리에 없는 모델은 거부한다", () => {
    expect(() => validateInput("no-such-model", {})).toThrow(/레지스트리에 없는/);
  });
});

describe("원화 환산", () => {
  it("1원 단위로 올림한다", () => {
    expect(usdToKrw("0.094", 1400)).toBe(132); // 131.6원
    expect(usdToKrw("0.050", 1400)).toBe(70);
    expect(usdToKrw("0", 1400)).toBe(0);
  });
  it("읽을 수 없는 금액과 환율은 거부한다", () => {
    expect(() => usdToKrw("abc", 1400)).toThrow();
    expect(() => usdToKrw("0.1", 0)).toThrow();
  });
});
