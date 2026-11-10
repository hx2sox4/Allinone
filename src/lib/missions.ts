import type { Mission, Prisma } from "@prisma/client";
import { db } from "./db";
import { LlmClient, llmConfigFromEnv } from "./llm/client";
import { judgeNews, planDesk, type DeskPlan } from "./llm/desk";
import { closedOnly, COINS, HyperliquidMarket, INTERVAL_MS, type MarketData } from "./market/hyperliquid";
import { backtest, MIN_VERIFY_TRADES, PROPR_COSTS } from "./trading/backtest";
import { recentHeadlines } from "./trading/news";
import { openPaperTrade, paperAccount, todayPnl, updateOpenTrades } from "./trading/paper";
import { checkRisk } from "./trading/risk";
import { getStrategy, series, STRATEGIES } from "./trading/strategies";
import { STAFF, type MEvent, type MLogged } from "./mission-events";

export interface MissionDeps { llm: LlmClient; market: MarketData; fetchImpl: typeof fetch; now?: () => number }
let cached: MissionDeps | undefined;
export function defaultMissionDeps(): MissionDeps {
  cached ??= { llm: new LlmClient(llmConfigFromEnv()), market: new HyperliquidMarket(), fetchImpl: fetch };
  return cached;
}

interface MState {
  plan?: DeskPlan;
  chosen?: string | null;
  riskOff?: boolean;
  signal?: { side: "long" | "short"; entry: number; stop: number; target: number; price: number; targetR: number } | null;
  ordered?: boolean;
  notes?: string[];
}
type Stage = "plan" | "research" | "news" | "timing" | "order" | "wrap" | "done";

const BARS = 4800;
const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 1 }) : n.toPrecision(5));
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const r2 = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}R`;

/** 기록을 한 줄 남긴다. 순번은 임무 안에서 1씩 늘어난다. */
export async function emit(missionId: string, ev: MEvent): Promise<void> {
  const m = await db.mission.update({ where: { id: missionId }, data: { seq: { increment: 1 } }, select: { seq: true } });
  await db.missionEvent.create({ data: { missionId, seq: m.seq, ev: ev as unknown as Prisma.InputJsonValue } });
}

export async function eventsAfter(missionId: string, after: number): Promise<MLogged[]> {
  const rows = await db.missionEvent.findMany({ where: { missionId, seq: { gt: after } }, orderBy: { seq: "asc" } });
  return rows.map((r) => ({ seq: r.seq, at: r.at.getTime(), ev: r.ev as unknown as MEvent }));
}

export async function startMission(args: { workspaceId: string; userId: string; prompt: string }): Promise<Mission> {
  const prompt = args.prompt.trim().slice(0, 500);
  if (!prompt) throw new Error("무엇을 맡길지 적어 주세요");
  const running = await db.mission.findFirst({ where: { workspaceId: args.workspaceId, status: "working" } });
  if (running) throw new Error("진행 중인 일이 끝난 뒤에 새 일을 맡길 수 있습니다");
  const m = await db.mission.create({ data: { workspaceId: args.workspaceId, createdById: args.userId, prompt, title: prompt.slice(0, 24) } });
  await emit(m.id, { k: "start", text: prompt });
  return m;
}

async function setStage(id: string, stage: Stage, state: MState) {
  await db.mission.update({ where: { id }, data: { stage, state: state as unknown as Prisma.InputJsonValue } });
}

async function hire(id: string, who: keyof typeof STAFF, task: string) {
  await emit(id, { k: "hire", id: who, role: STAFF[who].role, type: who, name: STAFF[who].name, task, prompt: task });
}

async function finish(id: string, ok: boolean, text: string, started: Date, status: "done" | "stopped" | "error" = ok ? "done" : "error") {
  await emit(id, { k: "end", ok, text, ms: Date.now() - started.getTime(), stopped: status === "stopped" });
  await db.mission.update({ where: { id }, data: { status, stage: "done", endedAt: new Date() } });
}

async function lock(id: string, waitMs = 0): Promise<boolean> {
  const until = Date.now() + waitMs;
  for (;;) {
    const now = new Date();
    const got = await db.mission.updateMany({ where: { id, status: "working", busyUntil: { lt: now } }, data: { busyUntil: new Date(now.getTime() + 120_000) } });
    if (got.count) return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}
const unlock = (id: string) => db.mission.updateMany({ where: { id }, data: { busyUntil: new Date(0) } });

/** 임무를 한 걸음 진행한다. 화면이 기록을 물어볼 때마다 불리며, 동시에 한 곳에서만 진행된다. */
export async function advanceMission(id: string, deps: MissionDeps = defaultMissionDeps()): Promise<void> {
  if (!(await lock(id))) return;
  try {
    for (let guard = 0; guard < 12; guard++) {
      const m = await db.mission.findUniqueOrThrow({ where: { id } });
      if (m.status !== "working") return;
      if (!(await step(m, deps))) return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "알 수 없는 오류";
    const m = await db.mission.findUnique({ where: { id } });
    if (m && m.status === "working") {
      await emit(id, { k: "error", message });
      await finish(id, false, `일을 끝내지 못했습니다: ${message}`, m.createdAt);
    }
  } finally {
    await unlock(id);
  }
}

/** true를 돌려주면 바로 다음 걸음을 이어 간다. */
async function step(m: Mission, deps: MissionDeps): Promise<boolean> {
  const id = m.id;
  const st = (m.state ?? {}) as MState;
  const now = deps.now?.() ?? Date.now();

  switch (m.stage as Stage) {
    case "plan": {
      await emit(id, { k: "think", who: "chef" });
      const plan = await planDesk(m.prompt, deps.llm);
      st.plan = plan;
      await db.mission.update({ where: { id }, data: { title: plan.title } });
      await emit(id, { k: "say", who: "chef", text: plan.reply });
      if (plan.mode === "none") {
        await setStage(id, "done", st);
        await finish(id, true, plan.reply, m.createdAt);
        return false;
      }
      const label = `${COINS[plan.coin].label} ${plan.interval}`;
      const items = [
        { text: `서준: ${label} 전략 백테스트`, status: "pending" as const },
        { text: "하린: 최근 24시간 뉴스 확인", status: "pending" as const },
        { text: "지호: 방금 마감한 봉의 진입 신호 확인", status: "pending" as const },
      ];
      if (plan.mode === "trade") items.push({ text: "다온: 리스크 확인 후 모의 주문", status: "pending" as const });
      await emit(id, { k: "plan", items });
      await hire(id, "seojun", `${label} 전략 ${STRATEGIES.length}개 백테스트`);
      await hire(id, "harin", `${COINS[plan.coin].label} 관련 최근 뉴스 확인`);
      await hire(id, "jiho", "진입 신호 확인");
      if (plan.mode === "trade") await hire(id, "daon", "리스크 확인과 모의 주문");
      await setStage(id, "research", st);
      return true;
    }

    case "research": {
      const plan = st.plan!;
      await emit(id, { k: "act", who: "seojun", id: "candles", kind: "web", tool: "Hyperliquid", label: `${plan.coin} ${plan.interval} 시세 ${BARS}개 받는 중`, detail: "Hyperliquid 공개 시세 (Propr와 같은 가격)" });
      const cs = closedOnly(await deps.market.candles(plan.coin, plan.interval, BARS, now), now);
      await emit(id, { k: "act_done", who: "seojun", id: "candles", ok: cs.length > 0 });
      if (cs.length < 400) throw new Error(`시세가 ${cs.length}개뿐이라 백테스트를 할 수 없습니다`);
      await emit(id, { k: "act", who: "seojun", id: "bt", kind: "bash", tool: "백테스트", label: `전략 ${STRATEGIES.length}개 백테스트`, detail: "앞 70% 학습, 뒤 30% 검증, Propr 수수료 포함" });
      const results = STRATEGIES.map((s) => ({ s, r: backtest(cs, s) }));
      const passed = results.filter((x) => x.r.passed).sort((a, b) => b.r.verify.avgR - a.r.verify.avgR);
      st.chosen = passed[0]?.s.key ?? null;
      await emit(id, { k: "act_done", who: "seojun", id: "bt", ok: true });
      await emit(id, {
        k: "backtest", who: "seojun", coin: plan.coin, interval: plan.interval, bars: cs.length, from: cs[0].t, to: cs[cs.length - 1].T, splitAt: results[0].r.splitAt,
        rows: results.map(({ s, r }) => ({ key: s.key, name: s.name, rule: s.rule, train: r.train, verify: r.verify, passed: r.passed, why: r.why })), chosen: st.chosen,
        costs: `시장가 ${PROPR_COSTS.feeTaker * 100}%, 지정가 ${PROPR_COSTS.feeMaker * 100}%, 슬리피지 ${PROPR_COSTS.slippage * 100}% 가정`,
      });
      const best = passed[0];
      await emit(id, { k: "report", who: "seojun", text: best
        ? `${best.s.name}만 기준을 통과했습니다. 검증 구간 ${best.r.verify.trades}건, 승률 ${pct(best.r.verify.winRate)}, 거래당 ${r2(best.r.verify.avgR)}. 과거 결과일 뿐 앞으로도 그렇다는 보장은 없습니다.`
        : `전략 ${STRATEGIES.length}개 모두 기준(학습·검증 모두 수수료 뒤 이익, 검증 ${MIN_VERIFY_TRADES}건 이상)을 통과하지 못했습니다. 이 조건에서는 매매하지 않는 것을 권합니다.` });
      await emit(id, { k: "leave", who: "seojun", ok: true, tokens: 0, tools: 2, ms: 0 });
      await setStage(id, "news", st);
      return true;
    }

    case "news": {
      const plan = st.plan!;
      const coin = COINS[plan.coin];
      await emit(id, { k: "act", who: "harin", id: "rss", kind: "web", tool: "RSS", label: "최근 24시간 헤드라인 모으는 중", detail: coin.news.join(", ") });
      const { items, failed } = await recentHeadlines(coin.news, { fetchImpl: deps.fetchImpl, now });
      await emit(id, { k: "act_done", who: "harin", id: "rss", ok: failed.length === 0 || items.length > 0 });
      let stance: "risk_off" | "neutral" | "supportive" | null = null, summary = "", used: number[] = [], model: string | null = null;
      if (items.length) {
        await emit(id, { k: "act", who: "harin", id: "judge", kind: "read", tool: "LLM", label: "헤드라인 읽는 중", detail: `${items.length}건` });
        try {
          const v = await judgeNews(coin.label, items, deps.llm);
          ({ stance, summary, used, model } = v);
          await emit(id, { k: "act_done", who: "harin", id: "judge", ok: true });
        } catch (e) {
          summary = `헤드라인을 판단하지 못했습니다(${e instanceof Error ? e.message : "오류"}). 뉴스는 이번 판단에 쓰지 않습니다.`;
          await emit(id, { k: "act_done", who: "harin", id: "judge", ok: false });
        }
      } else {
        summary = failed.length ? "뉴스를 가져오지 못했습니다. 뉴스는 이번 판단에 쓰지 않습니다." : "최근 24시간 안에 관련 헤드라인이 없습니다.";
      }
      st.riskOff = stance === "risk_off";
      await emit(id, { k: "news", who: "harin", items, failed, stance, summary, used, model });
      const label = stance === "risk_off" ? "위험 회피" : stance === "supportive" ? "우호적" : stance === "neutral" ? "중립" : "판단 없음";
      await emit(id, { k: "report", who: "harin", text: `뉴스 의견: ${label}. ${summary}` });
      await emit(id, { k: "leave", who: "harin", ok: true, tokens: 0, tools: 1, ms: 0 });
      await setStage(id, "timing", st);
      return true;
    }

    case "timing": {
      const plan = st.plan!;
      const strat = st.chosen ? getStrategy(st.chosen) : undefined;
      await emit(id, { k: "act", who: "jiho", id: "bar", kind: "read", tool: "Hyperliquid", label: "방금 마감한 봉 확인 중", detail: strat?.name ?? "통과한 전략 없음" });
      const cs = closedOnly(await deps.market.candles(plan.coin, plan.interval, 400, now), now);
      const last = cs[cs.length - 1];
      if (!last) throw new Error("마감한 봉을 받지 못했습니다");
      const mins = await deps.market.candles(plan.coin, "1m", 3, now);
      const price = mins.length ? mins[mins.length - 1].c : null;
      await emit(id, { k: "act_done", who: "jiho", id: "bar", ok: true });
      let note: string;
      st.signal = null;
      const stale = now - last.T > 2 * INTERVAL_MS[plan.interval];
      if (!strat) note = "검증을 통과한 전략이 없어 신호를 보지 않았습니다.";
      else if (stale) note = "마지막 봉이 너무 오래돼 판단하지 않았습니다.";
      else {
        const s = series(cs);
        const sig = strat.signal(s, cs.length - 1);
        if (!sig) note = `${strat.name}: 이번 봉에는 진입 조건이 없습니다. (종가 ${fmt(last.c)}, EMA20 ${fmt(s.ema20.at(-1)!)}, EMA200 ${fmt(s.ema200.at(-1)!)}, RSI(2) ${s.rsi2.at(-1)!.toFixed(0)})`;
        else if (price === null) note = "현재가를 받지 못해 진입가를 정할 수 없습니다.";
        else {
          const risk = sig.side === "long" ? price - sig.stop : sig.stop - price;
          if (!(risk > 0)) note = `${strat.name}: 신호는 났지만 현재가 ${fmt(price)}가 이미 손절가 ${fmt(sig.stop)}를 넘어 진입하지 않습니다.`;
          else {
            const target = sig.side === "long" ? price + risk * sig.targetR : price - risk * sig.targetR;
            st.signal = { side: sig.side, entry: price, stop: sig.stop, target, price, targetR: sig.targetR };
            note = `${strat.name}: ${sig.side === "long" ? "롱" : "숏"} 신호. 현재가 ${fmt(price)}, 손절 ${fmt(sig.stop)}, 목표 ${fmt(target)} (${sig.targetR}R).`;
          }
        }
      }
      await emit(id, { k: "timing", who: "jiho", strategy: strat?.key ?? null, barAt: last.t, close: last.c, price, signal: st.signal ? { side: st.signal.side, entry: st.signal.entry, stop: st.signal.stop, target: st.signal.target } : null, note });
      await emit(id, { k: "report", who: "jiho", text: note });
      await emit(id, { k: "leave", who: "jiho", ok: true, tokens: 0, tools: 1, ms: 0 });
      await setStage(id, plan.mode === "trade" ? "order" : "wrap", st);
      return true;
    }

    case "order": {
      const plan = st.plan!;
      await emit(id, { k: "act", who: "daon", id: "risk", kind: "plan", tool: "리스크 규칙", label: "리스크 확인 중", detail: "1회 위험, 일일 손실 한도, 레버리지 상한, 중복 포지션" });
      const acct = await paperAccount(m.workspaceId);
      await updateOpenTrades(m.workspaceId, deps.market, now);
      const sig = st.signal;
      let text: string;
      if (!sig) {
        text = "진입 신호가 없어 주문하지 않았습니다.";
        await emit(id, { k: "act_done", who: "daon", id: "risk", ok: true });
        await emit(id, { k: "order", who: "daon", ok: false, text });
      } else {
        const fresh = await db.paperAccount.findUniqueOrThrow({ where: { workspaceId: m.workspaceId } });
        const hasOpen = (await db.paperTrade.count({ where: { workspaceId: m.workspaceId, coin: plan.coin, status: "open" } })) > 0;
        // 수량은 슬리피지를 넣은 예상 체결가로 계산해야 1회 위험을 넘지 않는다.
        const fill = sig.price * (1 + (sig.side === "long" ? PROPR_COSTS.slippage : -PROPR_COSTS.slippage));
        const target = fill + (sig.side === "long" ? 1 : -1) * Math.abs(fill - sig.stop) * sig.targetR;
        const d = checkRisk({ balance: fresh.balance, riskPct: acct.riskPct, maxLeverage: acct.maxLeverage, dailyStopPct: acct.dailyStopPct, todayPnl: await todayPnl(m.workspaceId, now), hasOpen, side: sig.side, entry: fill, stop: sig.stop, newsRiskOff: !!st.riskOff });
        await emit(id, { k: "act_done", who: "daon", id: "risk", ok: d.ok });
        if (!d.ok) {
          text = `주문하지 않았습니다: ${d.reason}.`;
          await emit(id, { k: "order", who: "daon", ok: false, text });
        } else {
          await emit(id, { k: "act", who: "daon", id: "order", kind: "edit", tool: "모의 계좌", label: "모의 주문 넣는 중", detail: `${sig.side === "long" ? "롱" : "숏"} ${d.qty} ${plan.coin}` });
          const strat = getStrategy(st.chosen!)!;
          const t = await openPaperTrade({ workspaceId: m.workspaceId, missionId: id, coin: plan.coin, side: sig.side, qty: d.qty, price: sig.price, stop: sig.stop, target, strategy: strat.key, interval: plan.interval, maxBars: strat.maxBars, now });
          st.ordered = true;
          text = `모의 ${sig.side === "long" ? "롱" : "숏"} ${d.qty} ${plan.coin}를 ${fmt(t.entry)}에 잡았습니다. 손절 ${fmt(t.stop)}, 목표 ${fmt(t.target)}. ${d.note}.`;
          await emit(id, { k: "act_done", who: "daon", id: "order", ok: true });
          await emit(id, { k: "order", who: "daon", ok: true, text, trade: { id: t.id, coin: t.coin, side: sig.side, qty: t.qty, entry: t.entry, stop: t.stop, target: t.target, strategy: strat.name } });
        }
      }
      await emit(id, { k: "report", who: "daon", text });
      await emit(id, { k: "leave", who: "daon", ok: true, tokens: 0, tools: 1, ms: 0 });
      await setStage(id, "wrap", st);
      return true;
    }

    case "wrap": {
      const plan = st.plan!;
      const text = st.ordered
        ? "모의 주문을 넣었습니다. 손절과 목표는 계좌 화면을 열 때마다 1분봉으로 확인합니다. 프린터를 누르면 분석 보고서를 볼 수 있습니다."
        : plan.mode === "analyze"
          ? "분석을 마쳤습니다. 주문은 하지 않았습니다. 프린터를 누르면 분석 보고서를 볼 수 있습니다."
          : "이번에는 주문하지 않았습니다. 이유는 프린터의 분석 보고서에 있습니다.";
      await emit(id, { k: "say", who: "chef", text });
      await finish(id, true, text, m.createdAt, "done");
      return false;
    }
  }
  return false;
}

/** 승인 요청은 모의매매에서는 쓰지 않는다. 실거래를 붙일 때 주문 승인에 쓴다. */
export async function answerAsk(id: string, requestId: string, allow: boolean): Promise<void> {
  void id; void requestId; void allow;
  throw new Error("이미 처리된 요청입니다");
}

export async function stopMission(id: string): Promise<void> {
  if (!(await lock(id, 8000))) return;
  try {
    const m = await db.mission.findUniqueOrThrow({ where: { id } });
    await finish(id, false, "일을 멈췄습니다.", m.createdAt, "stopped");
  } finally {
    await unlock(id);
  }
}
