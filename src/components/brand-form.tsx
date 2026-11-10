"use client";

import { useFormAction } from "./use-form-action";
import { saveBrand } from "@/app/actions";

const input = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600";
const INDUSTRIES = ["카페·디저트", "음식점", "뷰티·미용", "패션·잡화", "온라인 셀러", "학원·교육", "운동·건강", "기타"];
const CHANNELS = ["인스타그램", "네이버 블로그", "네이버 스마트플레이스", "카카오톡 채널", "유튜브 쇼츠", "스마트스토어", "쿠팡"];

export interface BrandValues {
  businessName: string;
  industry: string;
  websiteUrl: string | null;
  speechLevel: string;
  voice: string;
  audience: string;
  offers: string;
  doSay: string;
  dontSay: string;
  channels: string[];
  palette: string[];
}

export function BrandForm({ brand }: { brand: BrandValues | null }) {
  const [state, onSubmit, pending] = useFormAction(saveBrand);
  const palette = [0, 1, 2].map((i) => brand?.palette[i] ?? ["#1f6f54", "#f4e9d8", "#2b2b2b"][i]);
  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="block text-sm font-medium">
        가게 이름
        <input name="businessName" required defaultValue={brand?.businessName} className={input} />
      </label>
      <label className="block text-sm font-medium">
        업종
        <select name="industry" required defaultValue={brand?.industry ?? ""} className={input}>
          <option value="" disabled>선택해 주세요</option>
          {INDUSTRIES.map((v) => <option key={v}>{v}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">
        홈페이지나 스토어 주소 (선택)
        <input name="websiteUrl" defaultValue={brand?.websiteUrl ?? ""} placeholder="https://" className={input} />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">고객에게 쓰는 말투</legend>
        <div className="mt-2 flex gap-4 text-sm">
          {["존댓말", "반말"].map((v) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="speechLevel" value={v} defaultChecked={(brand?.speechLevel ?? "존댓말") === v} /> {v}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm font-medium">
        말투와 분위기
        <input name="voice" required defaultValue={brand?.voice} placeholder="예: 다정하고 솔직하게, 이모지는 조금만" className={input} />
      </label>
      <label className="block text-sm font-medium">
        주요 고객
        <input name="audience" required defaultValue={brand?.audience} placeholder="예: 근처 직장인, 20~30대" className={input} />
      </label>
      <label className="block text-sm font-medium">
        대표 상품이나 서비스
        <textarea name="offers" required defaultValue={brand?.offers} rows={3} className={input} />
      </label>
      <label className="block text-sm font-medium">
        꼭 넣고 싶은 말 (선택)
        <input name="doSay" defaultValue={brand?.doSay} className={input} />
      </label>
      <label className="block text-sm font-medium">
        쓰면 안 되는 말 (선택)
        <input name="dontSay" defaultValue={brand?.dontSay} placeholder="예: 최고, 1등 같은 근거 없는 표현" className={input} />
      </label>
      <fieldset>
        <legend className="text-sm font-medium">운영하는 채널</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          {CHANNELS.map((v) => (
            <label key={v} className="flex items-center gap-2">
              <input type="checkbox" name="channels" value={v} defaultChecked={brand?.channels.includes(v)} /> {v}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-medium">브랜드 색상 3가지</legend>
        <div className="mt-2 flex gap-3">
          {palette.map((c, i) => (
            <input key={i} type="color" name="palette" defaultValue={c} aria-label={`브랜드 색상 ${i + 1}`} className="h-11 w-16 rounded border border-stone-300 bg-white" />
          ))}
        </div>
      </fieldset>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-60">
        {pending ? "저장하는 중" : "브랜드 기억 저장"}
      </button>
    </form>
  );
}
