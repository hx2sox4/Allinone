import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setApprovalAction } from "@/app/actions";
import { canEdit, currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { MODELS, getModel } from "@/lib/higgsfield/registry";
import { OverlayEditor } from "@/components/overlay-editor";
import { TopNav } from "@/components/top-nav";
import { VideoForm } from "@/components/video-form";

const videoModels = MODELS.filter((m) => m.kind === "video" && m.fields.image_url).map((m) => ({ key: m.key, name: m.name }));
const APPROVAL_LABEL: Record<string, string> = { PENDING: "검토 전", APPROVED: "승인", REJECTED: "보류" };

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await currentContext();
  if (!c) redirect("/login");
  if (!c.brand) redirect("/onboarding");
  const asset = await db.asset.findFirst({ where: { id, workspaceId: c.workspace.id }, include: { job: { include: { brief: true } } } });
  if (!asset) notFound();
  const rootId = asset.parentAssetId ?? asset.id;
  const versions = await db.asset.findMany({ where: { OR: [{ id: rootId }, { parentAssetId: rootId }] }, orderBy: { version: "asc" } });
  const editable = canEdit(c.role);
  const model = getModel(asset.job.modelKey);
  const input = asset.job.input as Record<string, unknown>;
  return (
    <>
      <TopNav current="/library" title="결과물 다듬기" />
      <p className="mb-3 text-sm"><Link href="/library" className="font-semibold text-emerald-700 underline">보관함으로</Link></p>
      <div className="grid gap-4 sm:grid-cols-2">
        {asset.kind === "VIDEO" ? (
          <video src={`/api/assets/${asset.id}`} controls className="w-full rounded-xl bg-stone-900" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/assets/${asset.id}`} alt={asset.job.brief?.what ?? "AI로 생성한 이미지"} className="w-full rounded-xl border border-stone-200 bg-stone-100" />
        )}
        <div>
          <dl className="space-y-2 text-sm">
            <Row k="상태" v={APPROVAL_LABEL[asset.approval]} />
            <Row k="버전" v={`${asset.version}${asset.overlayText ? ` · 문구: ${asset.overlayText}` : ""}`} />
            <Row k="브리프" v={asset.job.brief?.what ?? "없음"} />
            <Row k="모델" v={model.name} />
            {typeof input.prompt === "string" && <Row k="프롬프트" v={input.prompt} />}
            <Row k="예상 비용" v={asset.job.estimateKrw !== null ? `${asset.job.estimateKrw.toLocaleString("ko-KR")}원 (작업 전체)` : "없음"} />
            <Row k="표시" v={`AI 생성물${asset.virtualPersonLabel ? " · 가상인물 표시 포함" : ""}`} />
          </dl>
          {editable && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(["APPROVED", "REJECTED", "PENDING"] as const).filter((s) => s !== asset.approval).map((s) => (
                <form key={s} action={setApprovalAction}>
                  <input type="hidden" name="assetId" value={asset.id} />
                  <input type="hidden" name="approval" value={s} />
                  <button className={`rounded-lg px-3 py-2 text-sm font-semibold ${s === "APPROVED" ? "bg-emerald-700 text-white" : "border border-stone-300 bg-white"}`}>
                    {s === "APPROVED" ? "이 시안 승인" : s === "REJECTED" ? "보류" : "검토 전으로 되돌리기"}
                  </button>
                </form>
              ))}
              <a href={`/api/assets/${asset.id}`} download className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold">내려받기</a>
            </div>
          )}
        </div>
      </div>

      {versions.length > 1 && (
        <section className="mt-6">
          <h2 className="font-semibold">버전 기록</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {versions.map((v) => (
              <li key={v.id}>
                <Link href={`/library/${v.id}`} aria-current={v.id === asset.id ? "page" : undefined} className={`block rounded-lg border-2 p-1 ${v.id === asset.id ? "border-emerald-600" : "border-stone-200"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/assets/${v.id}`} alt={`버전 ${v.version}${v.overlayText ? `: ${v.overlayText}` : " 원본"}`} className="h-20 w-20 rounded object-cover" />
                  <span className="block text-center text-xs">버전 {v.version}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editable && asset.kind === "IMAGE" && (
        <>
          <section className="mt-6 rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="font-semibold">한글 문구 얹기</h2>
            <p className="mt-1 text-sm text-stone-600">글자는 AI가 그리지 않고 앱이 직접 넣습니다. 그래서 오탈자 없이 정확하게 들어갑니다.</p>
            <div className="mt-3"><OverlayEditor assetId={asset.id} palette={c.brand.palette} /></div>
          </section>
          <section className="mt-6 rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="font-semibold">이 시안으로 영상 만들기</h2>
            <div className="mt-3"><VideoForm assetId={asset.id} models={videoModels} /></div>
          </section>
        </>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-16 shrink-0 text-stone-500">{k}</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </div>
  );
}

export default function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Suspense fallback={<p className="text-sm text-stone-500">불러오는 중</p>}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}
