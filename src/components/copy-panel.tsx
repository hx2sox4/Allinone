"use client";

import { writeCopyAction } from "@/app/actions";
import { useFormAction } from "./use-form-action";

export interface CopyView {
  instagram: { caption: string; hashtags: string[] };
  image_overlay: string[];
  sms: string;
}

/** 글샘(문구 담당)의 초안. LLM이 쓴 글이라 발행 전 사람이 확인해야 한다. */
export function CopyPanel({ briefId, copy, warnings, model, editable }: { briefId: string; copy: CopyView | null; warnings: string[]; model: string | null; editable: boolean }) {
  const [state, onSubmit, pending] = useFormAction(writeCopyAction);
  return (
    <div className="mt-3 rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">글샘의 문구 초안</p>
        {editable && (
          <form onSubmit={onSubmit}>
            <input type="hidden" name="briefId" value={briefId} />
            <button disabled={pending} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-semibold disabled:opacity-60">{pending ? "쓰는 중" : copy ? "다시 받기" : "문구 받기"}</button>
          </form>
        )}
      </div>
      {state?.error && <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}
      {!copy && <p className="mt-2 text-sm text-stone-600">인스타그램 캡션, 이미지 위 문구, 문자 광고 초안을 받습니다.</p>}
      {copy && (
        <dl className="mt-2 space-y-2 text-sm">
          <div>
            <dt className="text-xs font-semibold text-stone-500">인스타그램 캡션</dt>
            <dd className="mt-0.5 leading-relaxed text-stone-800">{copy.instagram.caption}</dd>
            <dd className="mt-0.5 text-stone-500">{copy.instagram.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-500">이미지 위 문구</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">{copy.image_overlay.map((s) => <span key={s} className="rounded-md bg-stone-100 px-2 py-1">{s}</span>)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-stone-500">문자 광고</dt>
            <dd className="mt-0.5 leading-relaxed text-stone-800">{copy.sms}</dd>
          </div>
          {warnings.length > 0 && (
            <div className="rounded-md bg-amber-50 p-2">
              <dt className="text-xs font-semibold text-amber-900">확인이 필요한 점</dt>
              {warnings.map((w) => <dd key={w} className="mt-0.5 text-amber-900">{w}</dd>)}
            </div>
          )}
          <p className="text-xs text-stone-500">AI가 쓴 초안입니다{model ? ` (${model})` : ""}. 사실과 표현을 확인한 뒤 쓰세요.</p>
        </dl>
      )}
    </div>
  );
}
