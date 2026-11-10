import { db } from "./db";
import { getModel } from "./higgsfield/registry";
import { isTerminal, refreshJob } from "./jobs";
import { TEAM, type MemberKey } from "./team";

export type Mood = "working" | "waiting" | "done" | "idle" | "soon";

export interface MemberState {
  key: MemberKey;
  mood: Mood;
  bubble: string;
}

export interface OfficeState {
  members: MemberState[];
  running: number;
  awaitingApproval: number;
  finishedAssets: number;
}

/** 작업 상태를 직원들의 지금 모습으로 바꾼다. 실제 작업이 없는 직원에게 가짜 일을 지어내지 않는다. */
export async function officeState(workspaceId: string, opts: { refresh?: boolean } = {}): Promise<OfficeState> {
  let jobs = await db.generationJob.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 30 });
  if (opts.refresh) {
    const stale = jobs.filter((j) => j.hfRequestId && !isTerminal(j.status) && j.status !== "ESTIMATED" && (!j.lastCheckedAt || Date.now() - j.lastCheckedAt.getTime() > 3000));
    if (stale.length > 0) {
      await Promise.all(stale.map((j) => refreshJob(j.id).catch(() => {})));
      jobs = await db.generationJob.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 30 });
    }
  }
  const running = jobs.filter((j) => j.status === "QUEUED" || j.status === "IN_PROGRESS");
  const waiting = jobs.filter((j) => j.status === "ESTIMATED");
  const finishedAssets = await db.asset.count({ where: { workspaceId } });
  const latest = jobs[0];

  let bitna: MemberState;
  if (running.length > 0) {
    const kind = getModel(running[0].modelKey).kind === "video" ? "영상" : "이미지";
    bitna = { key: "bitna", mood: "working", bubble: running.length > 1 ? `${kind} 외 ${running.length - 1}건 만드는 중` : `${kind} 만드는 중` };
  } else if (waiting.length > 0) {
    const sum = waiting.reduce((a, j) => a + (j.estimateKrw ?? 0), 0);
    bitna = { key: "bitna", mood: "waiting", bubble: `승인 기다리는 중 · ${sum.toLocaleString("ko-KR")}원` };
  } else if (latest?.status === "COMPLETED") {
    bitna = { key: "bitna", mood: "done", bubble: "방금 완성했어요" };
  } else if (latest?.status === "NSFW" || latest?.status === "FAILED") {
    bitna = { key: "bitna", mood: "idle", bubble: "지난 작업은 중단됐어요 · 비용 없음" };
  } else {
    bitna = { key: "bitna", mood: "idle", bubble: "무엇을 만들까요?" };
  }

  return {
    members: TEAM.map((m) => (m.key === "bitna" ? bitna : { key: m.key, mood: "soon" as const, bubble: "곧 합류해요" })),
    running: running.length,
    awaitingApproval: waiting.length,
    finishedAssets,
  };
}
