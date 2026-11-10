"use client";
// 프린터에서 나오는 분석 보고서. 서버 기록에 있는 숫자만 보여 준다.
import type { BtStats } from "@/lib/trading/backtest";
import type { OfficeState } from "./state";

const d = (ms: number) => new Date(ms).toLocaleString("ko-KR", { year: "2-digit", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const n = (x: number) => (Math.abs(x) >= 100 ? x.toLocaleString("en-US", { maximumFractionDigits: 1 }) : x.toPrecision(5));
const pf = (x: number | null) => (x === null || !Number.isFinite(x) ? "-" : x.toFixed(2));

function Cells({ s }: { s: BtStats }) {
  return (
    <>
      <td>{s.trades}</td>
      <td>{s.trades ? `${(s.winRate * 100).toFixed(0)}%` : "-"}</td>
      <td>{s.trades ? `${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R` : "-"}</td>
      <td>{s.trades ? pf(s.profitFactor) : "-"}</td>
    </>
  );
}

export function DeskReport({ desk }: { desk: OfficeState["desk"] }) {
  const { backtest: bt, news, timing, order } = desk;
  return (
    <div className="bu-copy">
      {bt && (
        <>
          <h3>서준 · 전략 백테스트 ({bt.coin} {bt.interval})</h3>
          <p className="bu-dim">봉 {bt.bars}개, {d(bt.from)} ~ {d(bt.to)}. {d(bt.splitAt)} 이전은 학습, 이후는 검증. {bt.costs}. 한 봉 안에서 손절과 목표가 모두 닿으면 손절로 계산.</p>
          <div className="bu-scroll">
            <table className="bu-table">
              <thead><tr><th>전략</th><th colSpan={4}>학습: 건수 / 승률 / 거래당 / PF</th><th colSpan={4}>검증: 건수 / 승률 / 거래당 / PF</th><th>판정</th></tr></thead>
              <tbody>
                {bt.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.name}</td><Cells s={r.train} /><Cells s={r.verify} />
                    <td className={r.passed ? "bu-pass" : "bu-fail"}>{r.passed ? "통과" : "탈락"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="bu-list">{bt.rows.map((r) => <li key={r.key}><b>{r.name}</b>: {r.why}<span className="bu-detail">{r.rule}</span></li>)}</ul>
          <p className="bu-dim">과거 데이터 결과이며 앞으로의 수익을 뜻하지 않습니다.</p>
        </>
      )}
      {news && (
        <>
          <h3>하린 · 뉴스</h3>
          <p>{news.summary}</p>
          {news.items.length > 0 && (
            <ol className="bu-list">
              {news.items.map((h, i) => (
                <li key={h.link || h.title}>{news.used.includes(i + 1) ? "★ " : ""}<a href={h.link} target="_blank" rel="noreferrer">{h.title}</a> <span className="bu-dim">{h.source} · {d(h.at)}</span></li>
              ))}
            </ol>
          )}
          {news.failed.length > 0 && <p className="bu-dim">가져오지 못한 피드: {news.failed.join(", ")}</p>}
          {news.model && <p className="bu-dim">판단 모델: {news.model}. 뉴스 의견은 진입을 막을 수만 있습니다.</p>}
        </>
      )}
      {timing && (
        <>
          <h3>지호 · 진입 타이밍</h3>
          <p>{timing.note}</p>
          <p className="bu-dim">기준 봉 {d(timing.barAt)} 시작, 종가 {n(timing.close)}{timing.price !== null ? `, 확인 시점 현재가 ${n(timing.price)}` : ""}</p>
        </>
      )}
      {order && (
        <>
          <h3>다온 · 리스크와 모의 주문</h3>
          <p>{order.text}</p>
        </>
      )}
    </div>
  );
}
