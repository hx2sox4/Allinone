"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBriefAction } from "@/app/actions";
import { useFormAction } from "./use-form-action";

export interface PhotoOption { id: string; name: string }
export interface ChannelOption { key: string; label: string; ratio: string }
export interface ImageModelOption { key: string; name: string; useCases: string[] }

const input = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600";

export function BriefForm({ channels, models, photos, paletteSize }: { channels: ChannelOption[]; models: ImageModelOption[]; photos: PhotoOption[]; paletteSize: number }) {
  const [state, onSubmit, pending] = useFormAction(createBriefAction);
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(f: File) {
    setUploading(true);
    setUploadError(null);
    const body = new FormData();
    body.set("file", f);
    body.set("kind", "PRODUCT");
    const res = await fetch("/api/uploads", { method: "POST", body });
    setUploading(false);
    if (file.current) file.current.value = "";
    if (!res.ok) return setUploadError((await res.json().catch(() => null))?.error ?? "사진을 올리지 못했습니다");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm font-medium">
        무엇을 만들까요
        <textarea name="what" required rows={3} maxLength={700} className={input} placeholder="예: 봄 딸기 시즌 한정 라떼 출시 홍보. 따뜻한 조명, 테이블 위에서 본 구도" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          어디에 올릴까요
          <select name="channel" className={input} defaultValue={channels[0].key}>
            {channels.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.ratio})</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">
          시안 개수
          <select name="variants" className={input} defaultValue="3">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}개</option>)}
          </select>
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">제품 사진 (선택하면 사진을 참조해 광고 시안을 만듭니다)</legend>
        {photos.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {photos.map((p) => (
              <label key={p.id} className="relative block cursor-pointer">
                <input type="checkbox" name="productIds" value={p.id} className="peer absolute left-1.5 top-1.5 z-10 h-4 w-4" aria-label={`제품 사진 ${p.name}`} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/brand-assets/${p.id}`} alt="" className="aspect-square w-full rounded-lg border-2 border-stone-200 object-cover peer-checked:border-emerald-600" />
              </label>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" aria-label="제품 사진 올리기" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="max-w-full text-sm file:mr-2 file:rounded-lg file:border-0 file:bg-stone-200 file:px-3 file:py-2 file:font-semibold" />
          {uploading && <span className="text-stone-500">올리는 중</span>}
        </div>
        {uploadError && <p role="alert" className="mt-1 text-sm text-red-700">{uploadError}</p>}
      </fieldset>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="exactColors" className="mt-1" disabled={paletteSize < 3} />
        <span>브랜드 색상 3가지를 정확히 지켜서 만들기{paletteSize < 3 && " (브랜드 기억에 색상 3가지를 먼저 저장해 주세요)"}</span>
      </label>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-stone-700">모델 직접 고르기</summary>
        <select name="modelKey" className={input} defaultValue="" aria-label="모델">
          <option value="">빛나의 추천에 맡기기</option>
          {models.map((m) => <option key={m.key} value={m.key}>{m.name} ({m.useCases.join(", ")})</option>)}
        </select>
      </details>

      {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button disabled={pending || uploading} className="rounded-lg bg-emerald-700 px-4 py-2.5 font-semibold text-white disabled:opacity-60">
        {pending ? "견적 받는 중" : "예상 비용 보기"}
      </button>
      <p className="text-xs text-stone-500">예상 비용을 확인하고 승인하기 전에는 비용이 발생하지 않습니다.</p>
    </form>
  );
}
