"use client";

import Link from "next/link";
import { useFormAction } from "./use-form-action";
import type { FormState } from "@/app/actions";

const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600";

export function AuthForm({ mode, action }: { mode: "login" | "signup"; action: (prev: FormState, form: FormData) => Promise<FormState> }) {
  const [state, onSubmit, pending] = useFormAction(action);
  const signup = mode === "signup";
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <p className="text-sm font-semibold text-emerald-700">일손</p>
      <h1 className="mt-1 text-2xl font-bold">{signup ? "우리 가게 AI 마케팅팀 만들기" : "다시 오셨네요"}</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {signup && (
          <label className="block text-sm font-medium">
            이름
            <input name="name" required className={`${input} mt-1`} autoComplete="name" />
          </label>
        )}
        <label className="block text-sm font-medium">
          이메일
          <input name="email" type="email" required className={`${input} mt-1`} autoComplete="email" />
        </label>
        <label className="block text-sm font-medium">
          비밀번호
          <input name="password" type="password" required minLength={signup ? 8 : undefined} className={`${input} mt-1`} autoComplete={signup ? "new-password" : "current-password"} />
        </label>
        {signup && (
          <label className="flex gap-2 rounded-lg bg-stone-100 p-3 text-sm leading-relaxed">
            <input type="checkbox" name="aiNotice" className="mt-1" />
            <span>이 서비스는 생성형 AI로 글, 이미지, 영상을 만듭니다. 만들어진 결과물에는 AI 생성물이라는 기록이 남습니다. 이 내용을 확인했습니다.</span>
          </label>
        )}
        {state?.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
        <button disabled={pending} className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white disabled:opacity-60">
          {pending ? "잠시만요" : signup ? "시작하기" : "로그인"}
        </button>
      </form>
      <p className="mt-4 text-sm text-stone-600">
        {signup ? "이미 계정이 있으신가요? " : "처음이신가요? "}
        <Link href={signup ? "/login" : "/signup"} className="font-semibold text-emerald-700 underline">
          {signup ? "로그인" : "가입하기"}
        </Link>
      </p>
    </main>
  );
}
