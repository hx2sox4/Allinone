// 사무실 화면의 기억. 서버 기록(MLogged)을 순서대로 받아 화면에 보여 줄 상태로 바꾼다.
import type { ActKind, PlanItem } from "@/vendor/bureau/shared/protocol";
import { STAFF, type DeskEvent, type MEvent } from "@/lib/mission-events";

export interface ActView { id: string; kind: ActKind; label: string; detail: string; tool: string; at: number; done?: boolean; ok?: boolean }
export interface AgentView { id: string; name: string; task: string; status: "working" | "done" | "failed"; acts: ActView[]; report?: string }
export interface AskView { requestId: string; who: string; label: string; detail: string }
export interface FileView { assetId: string; kind: "image" | "video"; by: string }

export interface OfficeState {
  prompt: string;
  chefSay: string;
  chefSayAt: number;
  chefThinking: boolean;
  plan: PlanItem[];
  agents: Record<string, AgentView>;
  order: string[];
  asks: Record<string, AskView>;
  files: FileView[];
  desk: { backtest?: Extract<DeskEvent, { k: "backtest" }>; news?: Extract<DeskEvent, { k: "news" }>; timing?: Extract<DeskEvent, { k: "timing" }>; order?: Extract<DeskEvent, { k: "order" }> };
  ended: { ok: boolean; text: string } | null;
  error: string | null;
}

export const emptyState = (): OfficeState => ({ prompt: "", chefSay: "", chefSayAt: 0, chefThinking: false, plan: [], agents: {}, order: [], asks: {}, files: [], desk: {}, ended: null, error: null });

export function reduce(s: OfficeState, ev: MEvent, now: number): OfficeState {
  switch (ev.k) {
    case "start": return { ...emptyState(), prompt: ev.text, chefThinking: true };
    case "think": return ev.who === "chef" ? { ...s, chefThinking: true } : s;
    case "say": return ev.who === "chef" ? { ...s, chefSay: ev.text, chefSayAt: now, chefThinking: false } : s;
    case "plan": return { ...s, plan: ev.items };
    case "hire": return { ...s, order: [...s.order, ev.id], agents: { ...s.agents, [ev.id]: { id: ev.id, name: STAFF[ev.id]?.name ?? ev.name, task: ev.task, status: "working", acts: [] } } };
    case "act": {
      const a = s.agents[ev.who];
      if (!a) return s;
      return { ...s, agents: { ...s.agents, [ev.who]: { ...a, acts: [...a.acts, { id: ev.id, kind: ev.kind, label: ev.label, detail: ev.detail, tool: ev.tool, at: now }] } } };
    }
    case "act_done": {
      const a = s.agents[ev.who];
      if (!a) return s;
      return { ...s, agents: { ...s.agents, [ev.who]: { ...a, acts: a.acts.map((x) => (x.id === ev.id && !x.done ? { ...x, done: true, ok: ev.ok } : x)) } } };
    }
    case "backtest": return { ...s, desk: { ...s.desk, backtest: ev } };
    case "news": return { ...s, desk: { ...s.desk, news: ev } };
    case "timing": return { ...s, desk: { ...s.desk, timing: ev } };
    case "order": return { ...s, desk: { ...s.desk, order: ev } };
    case "report": {
      const a = s.agents[ev.who];
      if (!a) return s;
      // 계획표 체크: 보고한 직원의 항목을 끝낸 것으로 표시한다.
      const key = `${STAFF[ev.who]?.name ?? a.name}:`;
      const plan = s.plan.map((p) => (p.text.includes(key) ? { ...p, status: "completed" as const } : p));
      return { ...s, plan, agents: { ...s.agents, [ev.who]: { ...a, report: a.report ? `${a.report}\n${ev.text}` : ev.text } } };
    }
    case "leave": {
      const a = s.agents[ev.who];
      if (!a) return s;
      return { ...s, agents: { ...s.agents, [ev.who]: { ...a, status: ev.ok ? "done" : "failed" } } };
    }
    case "file": return { ...s, files: [...s.files, { assetId: ev.file.path, kind: ev.file.ext === "video" ? "video" : "image", by: ev.file.by }] };
    case "ask": return { ...s, asks: { ...s.asks, [ev.requestId]: { requestId: ev.requestId, who: ev.who, label: ev.label, detail: ev.detail } } };
    case "ask_done": {
      const asks = { ...s.asks };
      delete asks[ev.requestId];
      return { ...s, asks };
    }
    case "end": return { ...s, ended: { ok: ev.ok, text: ev.text }, chefSay: ev.text, chefSayAt: now, chefThinking: false, asks: {} };
    case "error": return { ...s, error: ev.message, chefThinking: false };
  }
  return s;
}
