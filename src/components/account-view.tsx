"use client";
import { useCallback, useEffect, useState } from "react";
import type { AccountSummary, TradeRow } from "@/lib/trading/account-view";

const n = (x: number) => (Math.abs(x) >= 100 ? x.toLocaleString("en-US", { maximumFractionDigits: 2 }) : x.toPrecision(5));
const usd = (x: number) => `${x >= 0 ? "" : "-"}${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const t = (ms: number | null) => (ms ? new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
const REASON: Record<string, string> = { stop: "손절", target: "목표", time: "보유기간 끝", manual: "직접 청산" };

export function AccountView({ canEdit }: { canEdit: boolean }) {
  const [a, setA] = useState<AccountSummary | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch("/api/paper", { cache: "no-store" });
    if (r.ok) setA(await r.json());
  }, []);
  useEffect(() => {
    const first = setTimeout(load, 0);
    const iv = setInterval(load, 30_000);
    return () => { clearTimeout(first); clearInterval(iv); };
  }, [load]);

  const post = async (body: object, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setErr("");
    const r = await fetch("/api/paper", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) setErr(j.error ?? "처리하지 못했습니다"); else setA(j);
  };

  if (!a) return <p className="text-sm text-stone-500">계좌를 불러오는 중</p>;
  const realized = a.balance - a.startEquity;
  return (
    <div className="space-y-6 text-sm">
      <p className="rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">모의 계좌입니다. 실제 돈과 실제 주문은 없습니다. 체결은 Hyperliquid 시세에 수수료(Propr 기준)와 슬리피지를 더해 가정합니다.</p>
      {a.updateError && <p className="text-red-700">시세를 받지 못해 열린 포지션을 확인하지 못했습니다: {a.updateError}</p>}
      {err && <p className="text-red-700">{err}</p>}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["잔고 (USDC)", usd(a.balance)], ["누적 실현 손익", usd(realized)], ["오늘(UTC) 실현 손익", usd(a.todayPnl)], ["승 / 패", `${a.wins} / ${a.losses}`]].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-white p-3 ring-1 ring-stone-200"><p className="text-stone-500">{k}</p><p className="text-lg font-bold">{v}</p></div>
        ))}
      </section>

      <section>
        <h2 className="mb-2 font-bold">열린 포지션</h2>
        {a.open.length === 0 ? <p className="text-stone-500">없습니다.</p> : <Table rows={a.open} open canEdit={canEdit} onClose={(id) => post({ action: "close", tradeId: id }, "현재가로 모의 청산할까요?")} busy={busy} />}
        <p className="mt-1 text-xs text-stone-500">이 화면은 30초마다 1분봉으로 손절·목표·보유기간을 확인합니다. 화면이 닫혀 있는 동안의 가격도 다음에 열 때 1분봉으로 거슬러 확인합니다.</p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">거래 기록</h2>
        {a.closed.length === 0 ? <p className="text-stone-500">아직 없습니다.</p> : <Table rows={a.closed} />}
      </section>

      {canEdit && (
        <section>
          <h2 className="mb-2 font-bold">리스크 설정 (다온이 지키는 규칙)</h2>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); void post({ action: "settings", riskPct: Number(f.get("riskPct")), dailyStopPct: Number(f.get("dailyStopPct")), maxLeverage: Number(f.get("maxLeverage")) }); }}>
            <label>1회 위험 %<input name="riskPct" type="number" step="0.05" min="0.05" max="2" defaultValue={a.riskPct} className="ml-2 w-20 rounded border px-2 py-1" /></label>
            <label>일일 손실 한도 %<input name="dailyStopPct" type="number" step="0.1" min="0.5" max="10" defaultValue={a.dailyStopPct} className="ml-2 w-20 rounded border px-2 py-1" /></label>
            <label>레버리지 상한<input name="maxLeverage" type="number" step="0.1" min="0.1" max="5" defaultValue={a.maxLeverage} className="ml-2 w-20 rounded border px-2 py-1" /></label>
            <button disabled={busy} className="rounded-full bg-emerald-700 px-4 py-1.5 font-semibold text-white">저장</button>
            <button type="button" disabled={busy} onClick={() => post({ action: "reset" }, "모의 거래 기록을 모두 지우고 잔고를 10,000으로 되돌릴까요?")} className="ml-auto text-stone-600 underline">모의 계좌 초기화</button>
          </form>
        </section>
      )}
    </div>
  );
}

function Table({ rows, open, canEdit, onClose, busy }: { rows: TradeRow[]; open?: boolean; canEdit?: boolean; onClose?: (id: string) => void; busy?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right">
        <thead className="text-stone-500"><tr><th className="text-left">종목</th><th>방향</th><th>수량</th><th>진입</th><th>손절</th><th>목표</th>{open ? <><th>보유 마감</th><th /></> : <><th>청산</th><th>사유</th><th>손익</th></>}<th>열림</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-stone-200">
              <td className="text-left">{r.coin} <span className="text-xs text-stone-500">{r.strategy} · {r.interval}</span></td>
              <td>{r.side === "long" ? "롱" : "숏"}</td><td>{r.qty}</td><td>{n(r.entry)}</td><td>{n(r.stop)}</td><td>{n(r.target)}</td>
              {open ? (
                <><td>{t(r.closeBy)}</td><td>{canEdit && <button disabled={busy} onClick={() => onClose?.(r.id)} className="underline">청산</button>}</td></>
              ) : (
                <><td>{r.exit !== null ? n(r.exit) : "-"}</td><td>{r.exitReason ? REASON[r.exitReason] ?? r.exitReason : "-"}</td><td className={(r.pnl ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"}>{r.pnl !== null ? usd(r.pnl) : "-"}</td></>
              )}
              <td>{t(r.openedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
