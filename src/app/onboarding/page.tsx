import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentContext } from "@/lib/auth";
import { BrandForm } from "@/components/brand-form";

async function Onboarding() {
  const c = await currentContext();
  if (!c) redirect("/login");
  return <BrandForm brand={c.brand} />;
}

export default function OnboardingPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm font-semibold text-emerald-700">일손</p>
      <h1 className="mt-1 text-2xl font-bold">우리 가게를 알려 주세요</h1>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">여기 적은 내용은 AI 직원 모두가 함께 기억합니다. 나중에 언제든 고칠 수 있습니다.</p>
      <div className="mt-6">
        <Suspense fallback={<p className="text-sm text-stone-500">불러오는 중</p>}>
          <Onboarding />
        </Suspense>
      </div>
    </main>
  );
}
