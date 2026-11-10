"use client";

import { makeVideoAction } from "@/app/actions";
import { useFormAction } from "./use-form-action";

export function VideoForm({ assetId, models }: { assetId: string; models: { key: string; name: string }[] }) {
  const [state, onSubmit, pending] = useFormAction(makeVideoAction);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="assetId" value={assetId} />
      <label className="block text-sm font-medium">
        어떤 움직임을 원하세요
        <textarea name="prompt" rows={2} className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600" placeholder="예: 컵 주위를 천천히 도는 카메라, 김이 피어오름" />
      </label>
      <label className="block text-sm font-medium">
        영상 모델
        <select name="modelKey" className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base">
          {models.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
        </select>
      </label>
      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{pending ? "견적 받는 중" : "영상 예상 비용 보기"}</button>
      <p className="text-xs text-stone-500">이 시안을 Higgsfield에 올려 시작 이미지로 씁니다. 승인 전에는 비용이 발생하지 않습니다.</p>
    </form>
  );
}
