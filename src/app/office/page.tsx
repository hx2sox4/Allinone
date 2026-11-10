import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canEdit, currentContext } from "@/lib/auth";
import { officeState } from "@/lib/office";
import { Office } from "@/components/office";
import { TopNav } from "@/components/top-nav";

async function OfficeView() {
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!c.brand) redirect("/onboarding");
  const state = await officeState(c.workspace.id);
  return (
    <>
      <TopNav current="/office" title={`${c.brand.businessName} 마케팅팀 사무실`} />
      <p className="-mt-2 mb-4 text-sm"><Link href="/intro" className="font-semibold text-emerald-700 underline">팀 소개 다시 보기</Link></p>
      <Office initial={state} canEdit={canEdit(c.role)} />
    </>
  );
}

export default function OfficePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Suspense fallback={<p className="text-sm text-stone-500">사무실 문을 여는 중</p>}>
        <OfficeView />
      </Suspense>
    </main>
  );
}
