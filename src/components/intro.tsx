"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TEAM, type Member } from "@/lib/team";
import { drawPerson } from "./pixel";

function Portrait({ member, size = 96 }: { member: Member; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, 16, 22);
    drawPerson(c, 2, 3, member.look);
  }, [member]);
  return <canvas ref={ref} width={16} height={22} aria-hidden="true" style={{ imageRendering: "pixelated", width: size, height: (size * 22) / 16 }} />;
}

const RM = "(prefers-reduced-motion: reduce)";
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(RM);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(RM).matches,
    () => false,
  );
}

/** 한 글자씩 나타나는 대사. 움직임 줄이기 설정이면 바로 전부 보여 준다. */
function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0);
  const still = useReducedMotion();
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), 28);
    return () => clearInterval(t);
  }, [text, still]);
  const shown = still ? text : text.slice(0, n);
  return (
    <p className="min-h-[3.5rem] text-base leading-relaxed text-stone-100" aria-label={text}>
      <span aria-hidden="true">{shown}</span>
      {!still && n < text.length && <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-emerald-300 align-middle" />}
    </p>
  );
}

export function Intro({ businessName, ownerName }: { businessName: string; ownerName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0); // 0: 제목, 1..5: 직원, 6: 출근 완료
  const last = TEAM.length + 1;
  const enter = () => router.push("/office");
  const next = () => (step >= last ? enter() : setStep(step + 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push("/office");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  const member = step >= 1 && step <= TEAM.length ? TEAM[step - 1] : null;

  return (
    <main className="flex min-h-screen flex-col bg-stone-900 text-stone-100">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-6">
        <div className="flex items-center justify-between text-sm">
          <ol className="flex gap-1.5" aria-label={`소개 진행 ${Math.min(step, TEAM.length)} / ${TEAM.length}`}>
            {TEAM.map((m, i) => (
              <li key={m.key} className={`h-1.5 w-8 rounded-full ${i < step ? "bg-emerald-400" : "bg-stone-700"}`} />
            ))}
          </ol>
          <button type="button" onClick={enter} className="rounded px-2 py-1 text-stone-400 underline hover:text-stone-100">건너뛰기</button>
        </div>

        <div className="flex flex-1 flex-col justify-center py-8" key={step}>
          {step === 0 && (
            <div className="intro-in text-center">
              <p className="text-sm font-semibold tracking-widest text-emerald-300">일손</p>
              <h1 className="mt-3 text-3xl font-bold leading-snug">{businessName}<br />마케팅팀이 출근했습니다</h1>
              <p className="mt-4 text-stone-300">{ownerName} 사장님, 오늘부터 함께 일할 다섯 명을 소개합니다.</p>
              <div className="mt-8 flex justify-center gap-2">
                {TEAM.map((m) => <Portrait key={m.key} member={m} size={44} />)}
              </div>
            </div>
          )}

          {member && (
            <div className="intro-in">
              <p className="text-sm font-semibold text-emerald-300">팀원 {step} / {TEAM.length}</p>
              <div className="mt-3 flex items-end gap-4">
                <div className="rounded-xl border-2 border-stone-700 bg-stone-800 p-3">
                  <Portrait member={member} />
                </div>
                <div>
                  <h1 className="text-4xl font-bold">{member.name}</h1>
                  <p className="mt-1 inline-block rounded-md px-2 py-0.5 text-sm font-bold text-stone-900" style={{ background: member.look.accent === "#1d3b4f" ? "#ffd0a8" : member.look.accent }}>{member.title}</p>
                </div>
              </div>
              <div className="mt-6 rounded-xl border-2 border-stone-700 bg-stone-800 p-4">
                <p className="text-xs font-bold tracking-widest text-emerald-300">임무</p>
                <p className="mt-1 text-lg font-bold">{member.mission}</p>
                <div className="mt-3 border-t border-stone-700 pt-3">
                  <Typed text={member.line} />
                </div>
                <ul className="mt-2 space-y-1 text-sm text-stone-300">
                  {member.duties.map((d) => <li key={d}>· {d}</li>)}
                </ul>
                {!member.active && <p className="mt-3 text-xs text-stone-400">아직 준비 중인 팀원입니다. 다음 개발 단계에서 일을 시작합니다.</p>}
              </div>
            </div>
          )}

          {step === last && (
            <div className="intro-in text-center">
              <div className="flex justify-center gap-2">
                {TEAM.map((m) => <Portrait key={m.key} member={m} size={52} />)}
              </div>
              <h1 className="mt-6 text-3xl font-bold">전원 출근 완료</h1>
              <p className="mt-3 text-stone-300">사무실에서 팀원을 누르면 지금 하는 일을 볼 수 있습니다. 지금은 빛나가 이미지와 영상을 만들 수 있습니다.</p>
            </div>
          )}
        </div>

        <button type="button" onClick={next} autoFocus className="w-full rounded-xl bg-emerald-500 px-4 py-4 text-lg font-bold text-stone-900 hover:bg-emerald-400">
          {step === 0 ? "팀원 만나기" : step < TEAM.length ? "다음 팀원" : step === TEAM.length ? "모두 만났어요" : "사무실로 들어가기"}
        </button>
      </div>
    </main>
  );
}
