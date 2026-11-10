"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { approveJob, cancelJobAction } from "@/app/actions";

export interface JobView {
  id: string;
  modelName: string;
  kind: "image" | "video";
  prompt: string;
  status: string;
  estimateKrw: number | null;
  estimateNote: string | null;
  error: string | null;
  pendingCopy: boolean;
  assets: { id: string; kind: string }[];
}

const LABEL: Record<string, string> = {
  ESTIMATED: "승인 대기",
  QUEUED: "대기 중",
  IN_PROGRESS: "만드는 중",
  COMPLETED: "완료",
  FAILED: "실패 (비용 없음)",
  NSFW: "심의로 중단 (비용 없음)",
  CANCELED: "취소됨",
};
const TONE: Record<string, string> = {
  ESTIMATED: "bg-amber-100 text-amber-900",
  QUEUED: "bg-sky-100 text-sky-900",
  IN_PROGRESS: "bg-sky-100 text-sky-900",
  COMPLETED: "bg-emerald-100 text-emerald-900",
  FAILED: "bg-red-100 text-red-900",
  NSFW: "bg-red-100 text-red-900",
  CANCELED: "bg-stone-200 text-stone-700",
};

export function JobCard({ job }: { job: JobView }) {
  const router = useRouter();
  const [polled, setPolled] = useState<Pick<JobView, "status" | "error" | "assets" | "pendingCopy"> | null>(null);
  // 서버에서 받은 값이 진행 중일 때만 조회 결과로 덮어쓴다. 새로 고침으로 끝난 상태가 오면 그 값을 쓴다.
  const propsRunning = job.status === "QUEUED" || job.status === "IN_PROGRESS" || job.pendingCopy;
  const live = propsRunning && polled ? polled : job;
  const running = live.status === "QUEUED" || live.status === "IN_PROGRESS" || live.pendingCopy;

  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/jobs/${job.id}`);
      if (!res.ok) return;
      const j = await res.json();
      setPolled({ status: j.status, error: j.error, assets: j.assets, pendingCopy: j.pendingCopy });
      if (j.status !== "QUEUED" && j.status !== "IN_PROGRESS" && !j.pendingCopy) router.refresh();
    }, 2000);
    return () => clearInterval(t);
  }, [running, job.id, router]);

  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{job.kind === "image" ? "이미지" : "영상"} · {job.modelName}</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[live.status]}`}>{live.pendingCopy ? "결과 보관하는 중" : (LABEL[live.status] ?? live.status)}</span>
      </div>
      {job.prompt && <p className="mt-2 text-sm leading-relaxed text-stone-700">{job.prompt}</p>}
      {job.estimateKrw !== null && (
        <p className="mt-2 text-sm text-stone-600">예상 비용 <span className="font-semibold tabular-nums text-stone-900">{job.estimateKrw.toLocaleString("ko-KR")}원</span></p>
      )}
      {job.estimateKrw === null && job.estimateNote && (
        <p className="mt-2 text-sm text-stone-600">이 모델은 사용량에 따라 과금되어 정해진 예상 금액이 없습니다. <span className="text-stone-500">Higgsfield 안내: {job.estimateNote}</span></p>
      )}
      {live.error && <p className="mt-2 text-sm text-red-700">{live.error}</p>}
      {live.status === "ESTIMATED" && (
        <div className="mt-3 flex gap-2">
          <form action={approveJob}>
            <input type="hidden" name="jobId" value={job.id} />
            <button className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">이 비용으로 만들기</button>
          </form>
          <form action={cancelJobAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <button className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold">취소</button>
          </form>
        </div>
      )}
      {live.status === "QUEUED" && (
        <form action={cancelJobAction} className="mt-3">
          <input type="hidden" name="jobId" value={job.id} />
          <button className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold">대기 중 취소</button>
        </form>
      )}
      {live.assets.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {live.assets.map((a) =>
            a.kind === "VIDEO" ? (
              <video key={a.id} src={`/api/assets/${a.id}`} controls className="aspect-square w-full rounded-lg bg-stone-100 object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={a.id} src={`/api/assets/${a.id}`} alt="AI로 생성한 이미지" className="aspect-square w-full rounded-lg bg-stone-100 object-cover" />
            ),
          )}
        </div>
      )}
      {live.assets.length > 0 && (
        <p className="mt-2 text-xs text-stone-500">
          AI로 생성한 결과물입니다. <Link href="/library" className="font-semibold text-emerald-700 underline">보관함에서 고르고 다듬기</Link>
        </p>
      )}
    </li>
  );
}
