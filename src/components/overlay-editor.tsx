"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { drawOverlay, type OverlaySpec } from "./overlay";

const input = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600";

export function OverlayEditor({ assetId, palette }: { assetId: string; palette: string[] }) {
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [spec, setSpec] = useState<OverlaySpec>({ headline: "", sub: "", position: "bottom", textColor: "#ffffff", bandColor: palette[0] ?? "#1f6f54", band: true, virtualPerson: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setError("이미지를 불러오지 못했습니다");
    i.src = `/api/assets/${assetId}`;
  }, [assetId]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || !img) return;
    let live = true;
    // 글꼴이 준비된 뒤에 그려야 저장본에 다른 글꼴이 들어가지 않는다.
    Promise.all([document.fonts.load('700 40px "Pretendard"', spec.headline || "가"), document.fonts.load('400 20px "Pretendard"', spec.sub || "가")])
      .catch(() => {})
      .then(() => {
        if (!live) return;
        el.width = img.naturalWidth;
        el.height = img.naturalHeight;
        const c = el.getContext("2d");
        if (c) drawOverlay(c, img, el.width, el.height, spec);
      });
    return () => { live = false; };
  }, [img, spec]);

  const set = <K extends keyof OverlaySpec>(k: K, v: OverlaySpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  const empty = !spec.headline.trim() && !spec.sub.trim() && !spec.virtualPerson;

  async function save() {
    const el = canvas.current;
    if (!el) return;
    setSaving(true);
    setError(null);
    const blob = await new Promise<Blob | null>((r) => el.toBlob(r, "image/png"));
    if (!blob) { setSaving(false); return setError("이미지를 만들지 못했습니다"); }
    const body = new FormData();
    body.set("image", blob, "composed.png");
    body.set("overlayText", [spec.headline.trim(), spec.sub.trim()].filter(Boolean).join(" / "));
    body.set("virtualPersonLabel", String(spec.virtualPerson));
    const res = await fetch(`/api/assets/${assetId}/compose`, { method: "POST", body });
    setSaving(false);
    if (!res.ok) return setError((await res.json().catch(() => null))?.error ?? "저장하지 못했습니다");
    const { id } = await res.json();
    router.push(`/library/${id}`);
    router.refresh();
  }

  const swatches = Array.from(new Set([...palette, "#ffffff", "#111111"]));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <canvas ref={canvas} className="w-full rounded-lg border border-stone-200 bg-stone-100" role="img" aria-label={`문구 미리보기: ${spec.headline} ${spec.sub}${spec.virtualPerson ? " 가상인물 표시 포함" : ""}`} />
      <div className="space-y-3">
        <label className="block text-sm font-medium">큰 문구<input value={spec.headline} onChange={(e) => set("headline", e.target.value)} maxLength={60} className={input} placeholder="예: 딸기 라떼 출시" /></label>
        <label className="block text-sm font-medium">작은 문구<input value={spec.sub} onChange={(e) => set("sub", e.target.value)} maxLength={120} className={input} placeholder="예: 3월 한 달, 하루 30잔 한정" /></label>
        <label className="block text-sm font-medium">
          위치
          <select value={spec.position} onChange={(e) => set("position", e.target.value as OverlaySpec["position"])} className={input}>
            <option value="top">위</option><option value="middle">가운데</option><option value="bottom">아래</option>
          </select>
        </label>
        <Swatches label="글자 색" value={spec.textColor} options={swatches} onChange={(v) => set("textColor", v)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={spec.band} onChange={(e) => set("band", e.target.checked)} /> 글자 뒤에 색 띠 넣기</label>
        {spec.band && <Swatches label="띠 색" value={spec.bandColor} options={swatches} onChange={(v) => set("bandColor", v)} />}
        <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm leading-relaxed">
          <input type="checkbox" checked={spec.virtualPerson} onChange={(e) => set("virtualPerson", e.target.checked)} className="mt-1" />
          <span>이 이미지에 AI로 만든 사람이 나옵니다. <strong>&apos;가상인물&apos; 표시</strong>를 넣습니다. 광고에 쓰는 AI 가상인물은 표시가 필요하며, 표시는 인물 가까이에 있어야 합니다. 위치가 맞는지 확인해 주세요.</span>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="button" onClick={save} disabled={saving || empty || !img} className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? "저장하는 중" : "새 버전으로 저장"}</button>
        <p className="text-xs text-stone-500">원본은 그대로 남고, 문구를 얹은 이미지가 새 버전으로 저장됩니다.</p>
      </div>
    </div>
  );
}

function Swatches({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value === o} aria-label={`${label} ${o}`} className={`h-9 w-9 rounded-full border-2 ${value === o ? "border-emerald-600 ring-2 ring-emerald-200" : "border-stone-300"}`} style={{ background: o }} />
        ))}
      </div>
    </fieldset>
  );
}
