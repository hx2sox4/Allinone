import { Suspense } from "react";
import { redirect } from "next/navigation";
import { approveBriefAction, cancelBriefAction } from "@/app/actions";
import { canEdit, currentContext } from "@/lib/auth";
import { CHANNELS } from "@/lib/briefs";
import { db } from "@/lib/db";
import { isCopyPending } from "@/lib/jobs";
import { MODELS, getModel } from "@/lib/higgsfield/registry";
import { BriefForm } from "@/components/brief-form";
import { CopyPanel, type CopyView } from "@/components/copy-panel";
import { JobCard, type JobView } from "@/components/job-card";
import { TopNav } from "@/components/top-nav";

const imageModels = MODELS.filter((m) => m.kind === "image").map((m) => ({ key: m.key, name: m.name, useCases: m.useCases }));

type JobRow = Awaited<ReturnType<typeof loadJobs>>[number];
const loadJobs = (workspaceId: string) =>
  db.generationJob.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 60, include: { assets: { where: { parentAssetId: null }, orderBy: { createdAt: "asc" } } } });

function toView(j: JobRow): JobView {
  const model = getModel(j.modelKey);
  const input = j.input as Record<string, unknown>;
  return {
    id: j.id,
    modelName: model.name,
    kind: model.kind,
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    status: j.status,
    estimateKrw: j.estimateKrw,
    estimateNote: j.estimateNote,
    error: j.error,
    pendingCopy: isCopyPending(j, j.assets.length),
    assets: j.assets.map((a) => ({ id: a.id, kind: a.kind })),
  };
}

async function Studio() {
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!c.brand) redirect("/onboarding");
  const [jobs, briefs, photos] = await Promise.all([
    loadJobs(c.workspace.id),
    db.brief.findMany({ where: { workspaceId: c.workspace.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.brandAsset.findMany({ where: { workspaceId: c.workspace.id, kind: "PRODUCT", NOT: { storageKey: "" } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const editable = canEdit(c.role);
  const loose = jobs.filter((j) => !j.briefId);
  return (
    <>
      <TopNav current="/studio" title="빛나의 제작실" />
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <h2 className="font-semibold">새 브리프</h2>
        <p className="mt-1 text-sm text-stone-600">
          {c.brand.businessName} · {c.brand.industry} · 브랜드 색상
          {c.brand.palette.map((p) => <span key={p} className="ml-1 inline-block h-3 w-3 rounded-full border border-stone-300 align-middle" style={{ background: p }} />)}
        </p>
        <div className="mt-4">
          {editable ? (
            <BriefForm channels={CHANNELS} models={imageModels} photos={photos.map((p) => ({ id: p.id, name: p.name }))} paletteSize={c.brand.palette.length} />
          ) : (
            <p className="text-sm text-stone-600">보기 권한만 있습니다.</p>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">작업 현황</h2>
        {briefs.length === 0 && loose.length === 0 && <p className="mt-3 text-sm text-stone-600">아직 만든 것이 없습니다. 위에서 첫 브리프를 적어 보세요.</p>}
        <div className="mt-3 space-y-5">
          {briefs.map((b) => {
            const mine = jobs.filter((j) => j.briefId === b.id);
            const pending = mine.filter((j) => j.status === "ESTIMATED");
            const pendingKrw = pending.reduce((a, j) => a + (j.estimateKrw ?? 0), 0);
            return (
              <article key={b.id} className="rounded-xl border border-stone-300 bg-stone-100 p-3">
                <h3 className="font-semibold leading-snug">{b.what}</h3>
                <p className="mt-1 text-sm text-stone-600">{b.channel} · {b.ratio} · 시안 {b.variants}개 · {getModel(b.modelKey).name}</p>
                <p className="mt-1 text-sm text-stone-600">{b.modelReason}{b.ratioNote ? ` ${b.ratioNote}` : ""}</p>
                {pending.length > 0 && editable && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3">
                    <p className="mr-auto text-sm">승인 대기 {pending.length}건 · 합계 <span className="font-bold tabular-nums">{pendingKrw.toLocaleString("ko-KR")}원</span></p>
                    <form action={approveBriefAction}>
                      <input type="hidden" name="briefId" value={b.id} />
                      <button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">전부 이 비용으로 만들기</button>
                    </form>
                    <form action={cancelBriefAction}>
                      <input type="hidden" name="briefId" value={b.id} />
                      <button className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold">전부 취소</button>
                    </form>
                  </div>
                )}
                <CopyPanel briefId={b.id} copy={(b.copyDraft as CopyView | null) ?? null} warnings={b.copyWarnings} model={b.copyModel} editable={editable} />
                <ul className="mt-3 space-y-3">{mine.map((j) => <JobCard key={j.id} job={toView(j)} />)}</ul>
              </article>
            );
          })}
          {loose.length > 0 && <ul className="space-y-3">{loose.map((j) => <JobCard key={j.id} job={toView(j)} />)}</ul>}
        </div>
      </section>
    </>
  );
}

export default function StudioPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Suspense fallback={<p className="text-sm text-stone-500">불러오는 중</p>}>
        <Studio />
      </Suspense>
    </main>
  );
}
