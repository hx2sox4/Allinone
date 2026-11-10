"use client";

// 사무실이 곧 앱이다. 픽셀 사무실은 가져온 엔진(src/vendor/bureau, MIT)이 그리고,
// 이 파일은 서버 기록을 엔진에 흘려보내고 말풍선, 입력창, 창(결과물, 계획, 지난 일)을 얹는다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { logout } from "@/app/actions";
import { isDeskEvent, STAFF, type MEvent, type MLogged, type MissionView } from "@/lib/mission-events";
import { DeskReport } from "./DeskReport";
import { emptyState, reduce, type OfficeState } from "./state";
import type { Hit, TimeOfDay } from "./engine";

type Engine = typeof import("./engine");
type Tod = "auto" | TimeOfDay;
type Modal = { kind: "agent"; id: string } | { kind: "board" } | { kind: "files" } | { kind: "history" } | { kind: "team" } | { kind: "machine" } | { kind: "menu" } | null;

const ICON: Record<string, string> = { search: "🔎", web: "🌐", read: "📖", write: "✍️", edit: "✏️", bash: "💻", plan: "🧮", skill: "🎓", mcp: "🔌", other: "🎨" };
const TOD_NEXT: Record<Tod, Tod> = { auto: "day", day: "evening", evening: "night", night: "auto" };
const todNow = (pref: Tod): TimeOfDay => {
  if (pref !== "auto") return pref;
  const h = new Date().getHours();
  return h >= 8 && h < 17 ? "day" : h >= 17 && h < 21 ? "evening" : "night";
};

/** 누를 수 있는 것의 한국어 설명. 없으면 누를 수 없는 것으로 본다. */
function labelOf(hit: Hit): string | null {
  if (hit.kind === "actor") return hit.id === "chef" ? "한결 팀장 · 눌러서 일 맡기기" : `${STAFF[hit.id]?.name ?? ""} · ${STAFF[hit.id]?.title ?? ""}`;
  if (hit.kind === "cat") return "사무실 고양이";
  const id = hit.id;
  if (id.startsWith("desk-") || id.startsWith("chair-desk-")) return "직원 자리";
  if (id.startsWith("zone:")) return "팀 소개";
  if (id.startsWith("plant-")) return "화분";
  const map: Record<string, string> = { board: "계획판 · 누가 무엇을 하는지", chefDesk: "한결의 책상 · 계획과 보고", chefChair: "한결에게 일 맡기기", printer: "프린터 · 분석 보고서", shelf: "책장 · 지난 일과 다시보기", rack: "서버 · 연결된 AI", door: "문 · 팀 소개", window: "창문 · 낮, 저녁, 밤", clock: "시계", neon: "네온 간판", coffee: "커피 머신", cooler: "정수기", lamp: "스탠드", "lamp-r": "스탠드", jukebox: "주크박스 (음악은 넣지 않았습니다)", sofa: "소파", easel: "이젤", bin: "휴지통", tableLow: "탁자", poster: "포스터" };
  return map[id] ?? null;
}

interface BubbleView { id: string; mode: "ask" | "full" | "tag"; name: string; text?: string; icon?: string; ask?: OfficeState["asks"][string] }
// 가져온 엔진의 화면 크기(layout.ts의 W, H)와 같다.
const W = 352, H = 256;
const short = (t: string, n = 44) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function OfficeApp({ canEdit, llmModel, initialMissions }: { canEdit: boolean; llmModel: string; initialMissions: MissionView[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const eng = useRef<Engine | null>(null);
  const bubbleEls = useRef(new Map<string, HTMLElement>());
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const [tod, setTod] = useState<Tod>("auto");
  const todRef = useRef<Tod>("auto");
  const [st, setSt] = useState<OfficeState>(emptyState);
  const [mission, setMission] = useState<MissionView | null>(null);
  const [missions, setMissions] = useState<MissionView[]>(initialMissions);
  const [replaying, setReplaying] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState("");
  const [views, setViews] = useState<BubbleView[]>([]);
  // 기록 재생: 서버에서 온 기록을 줄 세워 두고 하나씩 사무실에 흘려보낸다.
  const queue = useRef<MLogged[]>([]);
  const lastSeq = useRef(0);
  const run = useRef({ id: "", live: false, gen: 0 });

  const note = useCallback((t: string) => { setToast(t); window.setTimeout(() => setToast((x) => (x === t ? "" : x)), 3200); }, []);

  const apply = useCallback((ev: MEvent, live: boolean) => {
    const e = eng.current;
    if (!e) return;
    if (!isDeskEvent(ev)) e.world.apply(ev, live);
    setSt((s) => reduce(s, ev, Date.now()));
  }, []);

  // 엔진 불러오기 (브라우저 전용)
  useEffect(() => {
    let alive = true;
    import("./engine").then((e) => {
      if (!alive) return;
      eng.current = e;
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  // 크기: 화면에 들어가는 가장 큰 배율
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || !ready) return;
    const e = eng.current!;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const f = Math.min((r.width - 8) / e.W, (r.height - 8) / e.H);
      const v = Math.max(0.5, Math.floor(f * 16) / 16);
      scaleRef.current = v;
      setScale(v);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, [ready]);

  // 그리기 반복
  useEffect(() => {
    if (!ready) return;
    const e = eng.current!;
    const vis = canvas.current!;
    const vg = vis.getContext("2d")!;
    const low = document.createElement("canvas");
    low.width = e.W;
    low.height = e.H;
    const lg = low.getContext("2d")!;
    lg.imageSmoothingEnabled = false;
    let raf = 0, last = performance.now(), acc = 0, active = true, lastCss = "";
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (document.hidden) return;
      acc += dt;
      const camMoving = e.camera.update(dt);
      e.world.setMusic(false, 0, false);
      if (acc < (active || camMoving ? 1 / 24 : 1 / 8)) return;
      active = e.world.update(acc);
      acc = 0;
      e.renderer.draw(lg, e.world, todNow(todRef.current), new Date());
      const k = Math.max(1, Math.ceil(scaleRef.current * (window.devicePixelRatio || 1) - 0.001));
      if (vis.width !== e.W * k || vis.height !== e.H * k) { vis.width = e.W * k; vis.height = e.H * k; }
      vg.imageSmoothingEnabled = false;
      vg.drawImage(low, 0, 0, e.W * k, e.H * k);
      const { transform } = e.camera.css(scaleRef.current);
      if (stage.current && transform !== lastCss) { stage.current.style.transform = transform; lastCss = transform; }
      // 말풍선을 직원 머리 위로
      const s = scaleRef.current, stageW = e.W * s;
      for (const [id, el] of bubbleEls.current) {
        const a = e.world.actors.get(id);
        if (!a) continue;
        const seated = a.seated && !!a.seat;
        const x = Math.round(a.x * s);
        const y = Math.round(((seated ? a.seat!.y : a.y) - (seated ? 19 : 22)) * s);
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        el.style.opacity = a.alpha.toFixed(2);
        const b = el.firstElementChild as HTMLElement | null;
        let dx = 0;
        if (b) {
          const half = b.offsetWidth / 2;
          if (x - half < 4) dx = 4 - (x - half);
          else if (x + half > stageW - 4) dx = stageW - 4 - (x + half);
        }
        el.style.setProperty("--dx", `${Math.round(dx)}px`);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  // 기록을 하나씩 흘려보내는 펌프. 다시보기는 실제 간격을 줄여서, 실시간은 최소 간격만 두고 보여 준다.
  useEffect(() => {
    if (!ready) return;
    let timer = 0;
    let held = 0;
    const pump = () => {
      const e = eng.current!;
      const head = queue.current[0];
      let wait = 200;
      // 직원이 자리에 앉기 전에 그 직원의 일을 보여 주지 않는다 (걸어오는 동안 잠깐 기다린다. 기록의 순서와 내용은 그대로다).
      const who = head && "who" in head.ev && head.ev.who !== "chef" && head.ev.k !== "think" ? head.ev.who : null;
      const actor = who ? e.world.actors.get(who) : null;
      if (head && actor && !actor.seated && !actor.left && held < 40) { held++; timer = window.setTimeout(pump, 200); return; }
      held = 0;
      const next = queue.current.shift();
      if (next) {
        apply(next.ev, true);
        const after = queue.current[0];
        const gap = after ? after.at - next.at : 0;
        const k = next.ev.k;
        // 실시간: 화면에서 읽을 수 있을 만큼만 간격을 둔다. 다시보기: 실제 간격을 줄여서 재생한다.
        wait = run.current.live ? (k === "hire" || k === "plan" ? 900 : k === "act" ? 1500 : k === "say" ? 1200 : 350) : Math.max(k === "act" ? 1500 : 500, Math.min(2500, gap / 3));
      }
      timer = window.setTimeout(pump, wait);
    };
    timer = window.setTimeout(pump, 200);
    return () => window.clearTimeout(timer);
  }, [ready, apply]);

  // 진행 중인 임무의 기록 받아 오기
  const poll = useCallback(async (id: string, gen: number) => {
    while (run.current.gen === gen) {
      try {
        const r = await fetch(`/api/missions/${id}?after=${lastSeq.current}`, { cache: "no-store" });
        if (r.ok) {
          const d = (await r.json()) as { mission: MissionView; events: MLogged[] };
          if (run.current.gen !== gen) return;
          for (const e of d.events) if (e.seq > lastSeq.current) { queue.current.push(e); lastSeq.current = e.seq; }
          setMission(d.mission);
          if (d.mission.status !== "working") {
            setMissions((list) => [d.mission, ...list.filter((m) => m.id !== d.mission.id)]);
            return;
          }
        }
      } catch { /* 네트워크가 잠깐 끊겨도 다음 번에 다시 받는다 */ }
      await new Promise((res) => window.setTimeout(res, 1300));
    }
  }, []);

  const begin = useCallback((m: MissionView, live: boolean) => {
    const e = eng.current!;
    run.current = { id: m.id, live, gen: run.current.gen + 1 };
    queue.current = [];
    lastSeq.current = 0;
    e.world.resetAll();
    e.camera.wide();
    setSt(emptyState());
    setMission(m);
    setReplaying(!live);
    setModal(null);
  }, []);

  // 처음 열 때: 진행 중인 일이 있으면 이어서 보여 준다 (지난 기록은 바로 반영, 이후는 실시간).
  useEffect(() => {
    if (!ready) return;
    const working = initialMissions.find((m) => m.status === "working");
    if (!working) return;
    (async () => {
      begin(working, true);
      const gen = run.current.gen;
      const r = await fetch(`/api/missions/${working.id}?after=0`, { cache: "no-store" });
      if (!r.ok || run.current.gen !== gen) return;
      const d = (await r.json()) as { events: MLogged[] };
      for (const e of d.events) { apply(e.ev, false); lastSeq.current = e.seq; }
      void poll(working.id, gen);
    })();
  }, [ready, initialMissions, begin, apply, poll]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await fetch("/api/missions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text }) });
      const d = (await r.json()) as { mission?: MissionView; error?: string };
      if (!r.ok || !d.mission) { note(d.error ?? "일을 시작하지 못했습니다"); return; }
      setDraft("");
      begin(d.mission, true);
      void poll(d.mission.id, run.current.gen);
    } finally { setSending(false); }
  };

  const answer = async (requestId: string, allow: boolean) => {
    if (!mission) return;
    const r = await fetch(`/api/missions/${mission.id}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, allow }) });
    if (!r.ok) note(((await r.json()) as { error?: string }).error ?? "처리하지 못했습니다");
  };

  const stop = async () => { if (mission) await fetch(`/api/missions/${mission.id}/stop`, { method: "POST" }); };

  const replay = async (m: MissionView) => {
    const r = await fetch(`/api/missions/${m.id}?after=0`, { cache: "no-store" });
    if (!r.ok) { note("기록을 불러오지 못했습니다"); return; }
    const d = (await r.json()) as { events: MLogged[] };
    begin(m, false);
    queue.current = d.events;
  };

  // 누르기
  const toWorld = (ev: { clientX: number; clientY: number }) => {
    const e = eng.current!;
    const r = stage.current!.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * e.W, y: ((ev.clientY - r.top) / r.height) * e.H };
  };
  const onMove = (ev: React.PointerEvent) => {
    const e = eng.current;
    if (!e || !tip.current || !wrap.current) return;
    if ((ev.target as HTMLElement).closest(".bu-ask")) return;
    const p = toWorld(ev);
    const h = e.hitAt(e.world, p.x, p.y);
    const label = h ? labelOf(h) : null;
    if (!label) { tip.current.style.opacity = "0"; wrap.current.style.cursor = ""; return; }
    const r = wrap.current.getBoundingClientRect();
    tip.current.textContent = label;
    tip.current.style.opacity = "1";
    tip.current.style.transform = `translate(${Math.round(Math.min(ev.clientX - r.left + 14, r.width - 180))}px, ${Math.round(ev.clientY - r.top + 16)}px)`;
    wrap.current.style.cursor = "pointer";
  };
  const onClick = (ev: React.MouseEvent) => {
    const e = eng.current;
    if (!e || (ev.target as HTMLElement).closest(".bu-ask")) return;
    const p = toWorld(ev);
    const h = e.hitAt(e.world, p.x, p.y);
    if (!h) return;
    if (h.kind === "actor") { if (h.id === "chef") input.current?.focus(); else setModal({ kind: "agent", id: h.id }); return; }
    if (h.kind === "cat") { e.world.petCat(); return; }
    const id = h.id;
    if (id.startsWith("desk-") || id.startsWith("chair-desk-")) {
      const deskId = id.startsWith("chair-") ? id.slice(6) : id;
      const who = [...e.world.actors.values()].find((a) => a.seated && a.seat?.deskId === deskId);
      setModal(who ? { kind: "agent", id: who.id } : { kind: "team" });
      return;
    }
    if (id.startsWith("zone:") || id === "door") { setModal({ kind: "team" }); return; }
    if (id.startsWith("plant-")) { e.world.wiggle(id, 0, 0); return; }
    switch (id) {
      case "board": case "chefDesk": setModal({ kind: "board" }); return;
      case "chefChair": input.current?.focus(); return;
      case "printer": setModal({ kind: "files" }); return;
      case "shelf": setModal({ kind: "history" }); return;
      case "rack": setModal({ kind: "machine" }); return;
      case "neon": e.world.neonNext(); return;
      case "window": { const n = TOD_NEXT[todRef.current]; todRef.current = n; setTod(n); return; }
      case "coffee": e.world.coffee(); return;
      case "cooler": e.world.cooler(); return;
      case "lamp": case "lamp-r": e.world.toggleLamp(id); return;
      case "jukebox": note("음악은 넣지 않았습니다."); return;
      case "easel": case "bin": case "tableLow": case "sofa": e.world.wiggle(id, 0, 0); return;
    }
  };
  const onWheel = (ev: React.WheelEvent) => {
    const e = eng.current;
    if (!e) return;
    const p = toWorld(ev);
    const z = Math.max(1, Math.min(2.6, e.camera.tzoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (z <= 1.01) e.camera.wide(6); else e.camera.shot(p.x, p.y, z, 8);
  };

  // 말풍선 내용: 기록에 있는 실제 행동만 보여 준다. 엔진의 현재 모습과 맞춰야 해서 짧은 간격으로 다시 계산한다.
  const stRef = useRef(st);
  const liveRef = useRef(false);
  useEffect(() => { stRef.current = st; liveRef.current = mission?.status === "working" && !replaying; }, [st, mission, replaying]);
  useEffect(() => {
    if (!ready) return;
    const compute = () => {
      const e = eng.current!;
      const s = stRef.current;
      const now = Date.now();
      const working = liveRef.current || (!s.ended && queue.current.length > 0);
      const out: BubbleView[] = [];
      for (const id of e.world.actors.keys()) {
        const name = STAFF[id]?.name ?? "";
        const actor = e.world.actors.get(id)!;
        const ask = Object.values(s.asks).find((a) => a.who === id);
        if (ask) { out.push({ id, mode: "ask", name, ask }); continue; }
        if (id === "chef") {
          const busy = s.order.filter((k) => s.agents[k]?.status === "working").length;
          if (s.chefThinking && working) out.push({ id, mode: "full", name, text: "요청을 읽고 일을 나누는 중", icon: "💭" });
          else if (s.chefSay && now - s.chefSayAt < 9000) out.push({ id, mode: "full", name, text: short(s.chefSay, 60) });
          else if (working && busy > 0) out.push({ id, mode: "full", name, text: `팀 보고 기다리는 중 (${s.order.length - busy}/${s.order.length})`, icon: "⏳" });
          else out.push({ id, mode: "tag", name });
          continue;
        }
        const a = s.agents[id];
        const act = a && !actor.moving && actor.seated ? [...a.acts].reverse().find((x) => !x.done) : undefined;
        out.push(act ? { id, mode: "full", name, text: act.label, icon: ICON[act.kind] } : { id, mode: "tag", name });
      }
      setViews((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out));
    };
    const t = window.setInterval(compute, 300);
    return () => window.clearInterval(t);
  }, [ready]);

  const pendingAsk = Object.values(st.asks)[0];

  return (
    <div className="bu-root">
      <header className="bu-top">
        <div className="min-w-0">
          <p className="bu-brand">일손 트레이딩 데스크</p>
          <p className="bu-sub">{replaying ? `다시보기 · ${mission?.title ?? ""}` : mission ? `${!st.ended ? "진행 중" : mission.status === "done" ? "완료" : mission.status === "stopped" ? "중단" : mission.status === "error" ? "오류" : "마무리 중"} · ${mission.title}` : "한결에게 일을 맡겨 보세요"}</p>
        </div>
        <div className="bu-actions">
          {mission?.status === "working" && !replaying && canEdit && <button onClick={stop} className="bu-btn bu-warn">멈추기</button>}
          <button onClick={() => setModal({ kind: "files" })} className="bu-btn">보고서{st.desk.backtest ? " 1" : ""}</button>
          <button onClick={() => setModal({ kind: "history" })} className="bu-btn">지난 일</button>
          <button onClick={() => setModal({ kind: "menu" })} className="bu-btn" aria-label="메뉴">메뉴</button>
        </div>
      </header>

      <div className="bu-office" ref={wrap} onPointerMove={onMove} onPointerLeave={() => { if (tip.current) tip.current.style.opacity = "0"; }} onClick={onClick} onWheel={onWheel} onDoubleClick={() => eng.current?.camera.wide(4)}>
        {!ready && <p className="bu-loading">사무실 문을 여는 중</p>}
        <div className="bu-frame" style={{ width: W * scale, height: H * scale }}>
          <div className="bu-stage" ref={stage} style={{ width: W * scale, height: H * scale, ["--s" as string]: scale }}>
            <canvas ref={canvas} className="bu-canvas" style={{ width: W * scale, height: H * scale }} />
            {views.map((v) => {
              const id = v.id;
              return (
                <div key={id} className="bu-anchor" ref={(el) => { if (el) bubbleEls.current.set(id, el); else bubbleEls.current.delete(id); }}>
                  {v.mode === "ask" && v.ask ? (
                    <div className="bu-bubble bu-ask">
                      <span className="bu-name">🙋 {v.name}</span>
                      <span>{v.ask.label}</span>
                      {canEdit && !replaying ? (
                        <span className="bu-askbtns">
                          <button onClick={() => answer(v.ask!.requestId, true)} className="bu-yes">승인</button>
                          <button onClick={() => answer(v.ask!.requestId, false)} className="bu-no">거절</button>
                        </span>
                      ) : <span className="bu-dim">{replaying ? "다시보기에서는 누를 수 없습니다" : "승인 권한이 없습니다"}</span>}
                    </div>
                  ) : v.mode === "full" ? (
                    <div className="bu-bubble"><span className="bu-name">{v.name}</span><span>{v.icon ? `${v.icon} ` : ""}{v.text}</span></div>
                  ) : <div className="bu-tag">{v.name}</div>}
                </div>
              );
            })}
          </div>
        </div>
        <div className="bu-tip" ref={tip} />
      </div>

      <footer className="bu-dialog">
        {pendingAsk && !replaying && (
          <div className="bu-askbar">
            <p><b>{STAFF[pendingAsk.who]?.name}</b>: {pendingAsk.label}. <span className="bu-dim">{pendingAsk.detail} 승인해야 실제로 만들고 비용이 듭니다.</span></p>
            {canEdit && <span className="bu-askbtns"><button onClick={() => answer(pendingAsk.requestId, true)} className="bu-yes">승인</button><button onClick={() => answer(pendingAsk.requestId, false)} className="bu-no">거절</button></span>}
          </div>
        )}
        {st.error && <p className="bu-err">오류: {st.error}</p>}
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="bu-form">
          <label htmlFor="bu-input" className="bu-who">한결</label>
          <input id="bu-input" ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!canEdit || (mission?.status === "working" && !replaying)} maxLength={500} placeholder={mission?.status === "working" && !replaying ? "지금 일이 끝나면 새 일을 맡길 수 있습니다" : "예: 비트코인 4시간봉 점검하고 조건 맞으면 모의 매수해줘"} className="bu-input" />
          <button disabled={sending || !draft.trim() || !canEdit} className="bu-send">맡기기</button>
        </form>
        <p className="bu-hint">모의매매만 합니다. 실제 돈과 실제 주문은 없습니다. 말풍선은 실제로 진행된 일만 보여 줍니다. 직원, 계획판, 프린터, 책장을 눌러 보세요.</p>
      </footer>

      {toast && <div className="bu-toast" role="status">{toast}</div>}
      {modal && (
        <div className="bu-modal-bg" onClick={() => setModal(null)}>
          <div className="bu-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="bu-close" onClick={() => setModal(null)} aria-label="닫기">닫기</button>
            <ModalBody modal={modal} st={st} mission={mission} missions={missions} replaying={replaying} llmModel={llmModel} onReplay={replay} tod={tod} />
          </div>
        </div>
      )}
    </div>
  );
}

function ModalBody({ modal, st, mission, missions, replaying, llmModel, onReplay, tod }: { modal: NonNullable<Modal>; st: OfficeState; mission: MissionView | null; missions: MissionView[]; replaying: boolean; llmModel: string; onReplay: (m: MissionView) => void; tod: Tod }) {
  if (modal.kind === "agent") {
    const a = st.agents[modal.id];
    const info = STAFF[modal.id];
    return (
      <>
        <h2>{info?.name} <small>{info?.title}</small></h2>
        <p className="bu-dim">{info?.what}</p>
        {a ? (
          <>
            <h3>맡은 일</h3><p>{a.task}</p>
            <h3>한 일</h3>
            {a.acts.length === 0 ? <p className="bu-dim">아직 시작 전입니다.</p> : <ul className="bu-list">{a.acts.map((x, i) => <li key={i}>{ICON[x.kind]} {x.label.replace(/ 중$/, "")} <span className="bu-dim">({x.tool}) {x.done ? (x.ok === false ? "실패" : "끝") : "진행 중"}</span>{x.detail && <span className="bu-detail">{x.detail}</span>}</li>)}</ul>}
            <h3>보고</h3>
            <p style={{ whiteSpace: "pre-line" }}>{a.report ?? "아직 보고 전입니다."}</p>
          </>
        ) : <p className="bu-dim">이번 일에는 참여하지 않았습니다.</p>}
      </>
    );
  }
  if (modal.kind === "board") {
    return (
      <>
        <h2>계획판</h2>
        {st.prompt && <p className="bu-quote">“{st.prompt}”</p>}
        {st.plan.length === 0 ? <p className="bu-dim">아직 계획이 없습니다. 한결에게 일을 맡기면 여기에 누가 무엇을 하는지 적힙니다.</p> : <ul className="bu-list">{st.plan.map((p, i) => <li key={i}>{p.status === "completed" ? "✅" : "⬜"} {p.text}</li>)}</ul>}
        {st.ended && <p><b>한결:</b> {st.ended.text}</p>}
      </>
    );
  }
  if (modal.kind === "files") {
    return (
      <>
        <h2>분석 보고서 {replaying && <small>다시보기</small>}</h2>
        {!st.desk.backtest && !st.desk.news ? <p className="bu-dim">{mission ? "아직 나온 보고가 없습니다." : "일을 맡기면 분석 보고서가 여기에 나옵니다."}</p> : <DeskReport desk={st.desk} />}
        <p><Link href="/account">모의 계좌 보기</Link></p>
      </>
    );
  }
  if (modal.kind === "history") {
    return (
      <>
        <h2>지난 일</h2>
        {missions.length === 0 ? <p className="bu-dim">아직 맡긴 일이 없습니다.</p> : (
          <ul className="bu-list">
            {missions.map((m) => (
              <li key={m.id} className="bu-hist">
                <span><b>{m.title}</b><span className="bu-detail">{m.prompt}</span><span className="bu-dim">{new Date(m.createdAt).toLocaleString("ko-KR")} · {m.status === "done" ? "완료" : m.status === "working" ? "진행 중" : m.status === "stopped" ? "중단" : "오류"}</span></span>
                {m.status !== "working" && <button className="bu-btn" onClick={() => onReplay(m)}>다시보기</button>}
              </li>
            ))}
          </ul>
        )}
        <p className="bu-dim">다시보기는 저장된 기록을 재생할 뿐이라 비용이 들지 않습니다.</p>
      </>
    );
  }
  if (modal.kind === "team") {
    return (
      <>
        <h2>팀 소개</h2>
        <ul className="bu-list">
          {Object.entries(STAFF).map(([k, v]) => <li key={k}><b>{v.name}</b> {v.title}<span className="bu-detail">{v.what}</span></li>)}
        </ul>
        <p className="bu-dim">직원은 일을 받을 때만 문으로 들어와 자리에 앉습니다.</p>
      </>
    );
  }
  if (modal.kind === "machine") {
    return (
      <>
        <h2>연결된 AI</h2>
        <ul className="bu-list">
          <li><b>LLM</b> {llmModel || "설정되지 않음"}<span className="bu-detail">한결의 일 정하기와 하린의 헤드라인 판단에만 씁니다. 전략, 신호, 주문 수량은 LLM이 아니라 정해진 규칙이 정합니다.</span></li>
          <li><b>시세</b> Hyperliquid 공개 API<span className="bu-detail">키 없이 받습니다. Propr가 거래하는 Hyperliquid 무기한과 같은 가격입니다.</span></li>
          <li><b>뉴스</b> RSS 헤드라인<span className="bu-detail">CoinDesk, Cointelegraph 공개 RSS의 제목과 링크만 씁니다. NEWS_FEEDS 환경 변수로 바꿀 수 있습니다.</span></li>
        </ul>
        <p className="bu-dim">창문 시간대: {tod === "auto" ? "자동" : tod === "day" ? "낮" : tod === "evening" ? "저녁" : "밤"} (창문을 누르면 바뀝니다)</p>
      </>
    );
  }
  return (
    <>
      <h2>메뉴</h2>
      <ul className="bu-list bu-menu">
        <li><Link href="/account">모의 계좌 (포지션, 거래 기록, 리스크 설정)</Link></li>
        <li><Link href="/intro">팀 소개 다시 보기</Link></li>
        <li><form action={logout}><button className="bu-link">로그아웃</button></form></li>
      </ul>
    </>
  );
}
