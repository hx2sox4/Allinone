"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MemberState, OfficeState } from "@/lib/office";
import { TEAM, type MemberKey } from "@/lib/team";
import { OFFICE_H, OFFICE_W, drawOffice } from "./pixel";

const MOOD_LABEL: Record<string, string> = { working: "일하는 중", waiting: "승인 대기", done: "완료", idle: "대기", soon: "다음 단계에서 합류" };

export function Office({ initial, canEdit }: { initial: OfficeState; canEdit: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState(initial);
  const [selected, setSelected] = useState<MemberKey>("bitna");
  const busy = state.running > 0;

  // 진행 중인 작업이 있을 때만 상태를 다시 읽는다.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      const res = await fetch("/api/office");
      if (res.ok) setState(await res.json());
    }, 2500);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    const c = canvas.current?.getContext("2d");
    if (!c) return;
    c.imageSmoothingEnabled = false;
    const moods = Object.fromEntries(state.members.map((m) => [m.key, m.mood]));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const paint = () => drawOffice(c, TEAM, moods, frame, selected);
    paint();
    if (still) return;
    const t = setInterval(() => {
      frame = frame ? 0 : 1;
      paint();
    }, 450);
    return () => clearInterval(t);
  }, [state, selected]);

  const byKey = Object.fromEntries(state.members.map((m) => [m.key, m])) as Record<MemberKey, MemberState>;
  const member = TEAM.find((m) => m.key === selected)!;
  const ms = byKey[selected];

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl border-4 border-stone-800 bg-stone-800 shadow-lg">
        <canvas ref={canvas} width={OFFICE_W} height={OFFICE_H} className="block w-full" style={{ imageRendering: "pixelated", aspectRatio: `${OFFICE_W} / ${OFFICE_H}` }} aria-hidden="true" />
        {TEAM.map((m) => {
          const s = byKey[m.key];
          const left = ((m.desk.x + 6) / OFFICE_W) * 100;
          const top = (m.desk.y / OFFICE_H) * 100;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setSelected(m.key)}
              aria-pressed={selected === m.key}
              aria-label={`${m.name}, ${m.title}. ${s.bubble}`}
              className="absolute -translate-x-1/2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              style={{ left: `${left}%`, top: `${top}%`, width: "16%", height: "22%" }}
            >
              <span
                className={`absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight sm:text-xs ${
                  s.mood === "soon" ? "border-stone-300 bg-white/70 text-stone-500" : s.mood === "working" ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-800 bg-white text-stone-900"
                }`}
              >
                {s.mood === "soon" ? m.name : `${m.name} · ${s.bubble}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
        <Stat label="만드는 중" value={state.running} />
        <Stat label="승인 대기" value={state.awaitingApproval} />
        <Stat label="보관한 결과물" value={state.finishedAssets} />
      </div>

      <section className="mt-4 rounded-xl border border-stone-200 bg-white p-4" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">
            {member.name} <span className="text-sm font-semibold text-stone-500">{member.title}</span>
          </h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${ms.mood === "soon" ? "bg-stone-200 text-stone-600" : "bg-emerald-100 text-emerald-900"}`}>{MOOD_LABEL[ms.mood]}</span>
        </div>
        <p className="mt-1 text-sm text-stone-700">{member.mission}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700">
          {member.duties.map((d) => <li key={d}>{d}</li>)}
        </ul>
        {member.active ? (
          <div className="mt-4">
            <p className="text-sm font-semibold">지금: {ms.bubble}</p>
            {canEdit && (
              <Link href="/studio" className="mt-3 inline-block rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">
                {state.awaitingApproval > 0 ? "예상 비용 확인하고 승인하기" : "빛나에게 일 맡기기"}
              </Link>
            )}
          </div>
        ) : (
          <p className="mt-4 rounded-lg bg-stone-100 p-3 text-sm text-stone-600">{member.name}는 아직 일을 시작하지 않았습니다. 다음 개발 단계에서 합류합니다.</p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-2 py-2">
      <p className="text-lg font-bold tabular-nums">{value.toLocaleString("ko-KR")}</p>
      <p className="text-xs text-stone-600">{label}</p>
    </div>
  );
}
