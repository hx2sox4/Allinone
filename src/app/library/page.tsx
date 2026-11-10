import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { TopNav } from "@/components/top-nav";

const APPROVAL: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "검토 전", tone: "bg-stone-200 text-stone-700" },
  APPROVED: { label: "승인", tone: "bg-emerald-100 text-emerald-900" },
  REJECTED: { label: "보류", tone: "bg-red-100 text-red-900" },
};

async function Library({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!c.brand) redirect("/onboarding");
  const { show } = await searchParams;
  const filter = show === "APPROVED" || show === "PENDING" || show === "REJECTED" ? show : undefined;
  const assets = await db.asset.findMany({
    where: { workspaceId: c.workspace.id, ...(filter ? { approval: filter } : {}) },
    orderBy: { createdAt: "desc" },
    take: 120,
    include: { job: { include: { brief: true } } },
  });
  const tabs = [{ key: "", label: "전체" }, { key: "PENDING", label: "검토 전" }, { key: "APPROVED", label: "승인" }, { key: "REJECTED", label: "보류" }];
  return (
    <>
      <TopNav current="/library" title="보관함" />
      <p className="text-sm text-stone-600">만든 결과물은 모두 우리 저장소에 보관됩니다. 눌러서 승인하거나, 문구를 얹거나, 영상으로 만들 수 있습니다.</p>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {tabs.map((t) => (
          <Link key={t.key} href={t.key ? `/library?show=${t.key}` : "/library"} aria-current={(filter ?? "") === t.key ? "page" : undefined} className={`rounded-full px-3 py-1.5 font-semibold ${(filter ?? "") === t.key ? "bg-stone-900 text-white" : "bg-white ring-1 ring-stone-200"}`}>
            {t.label}
          </Link>
        ))}
      </div>
      {assets.length === 0 ? (
        <p className="mt-6 text-sm text-stone-600">{filter ? "이 조건에 맞는 결과물이 없습니다." : "아직 보관한 결과물이 없습니다. 제작실에서 첫 시안을 만들어 보세요."}</p>
      ) : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {assets.map((a) => (
            <li key={a.id}>
              <Link href={`/library/${a.id}`} className="block rounded-xl border border-stone-200 bg-white p-2 hover:border-emerald-600">
                {a.kind === "VIDEO" ? (
                  <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-stone-800 text-sm font-semibold text-white">영상</div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/assets/${a.id}`} alt={a.job.brief?.what ?? "AI로 생성한 이미지"} className="aspect-square w-full rounded-lg bg-stone-100 object-cover" loading="lazy" />
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${APPROVAL[a.approval].tone}`}>{APPROVAL[a.approval].label}</span>
                  {a.version > 1 && <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-900">버전 {a.version}</span>}
                  {a.virtualPersonLabel && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">가상인물 표시</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-stone-600">{a.job.brief?.what ?? ""}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function LibraryPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Suspense fallback={<p className="text-sm text-stone-500">불러오는 중</p>}>
        <Library searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
