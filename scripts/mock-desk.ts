// 트레이딩 데스크 모의 서버 (포트 4020). 실제 시세·뉴스·LLM 없이 화면 흐름을 확인할 때 쓴다.
// .env: HL_INFO_URL=http://127.0.0.1:4020/info, NEWS_FEEDS=http://127.0.0.1:4020/rss, LLM_API_BASE=http://127.0.0.1:4020, LLM_API_KEY=mock
// 시세는 가짜 추세 데이터이며 실제 가격이 아니다.
import { createServer } from "node:http";
import { INTERVAL_MS, type Interval } from "../src/lib/market/hyperliquid";
import { synth } from "../tests/helpers/candles";

const port = Number(process.env.MOCK_DESK_PORT ?? 4020);
createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  if (req.url === "/info") {
    const { req: q } = JSON.parse(body) as { req: { interval: Interval; startTime: number; endTime: number } };
    const bars = Math.min(5000, Math.ceil((q.endTime - q.startTime) / INTERVAL_MS[q.interval]));
    const cs = synth(bars, q.interval, q.endTime, { drift: q.interval === "1m" ? 0 : 0.0005, start: 90_000 });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(cs.map((k) => ({ t: k.t, T: k.T, o: String(k.o), h: String(k.h), l: String(k.l), c: String(k.c), v: "1" }))));
    return;
  }
  if (req.url === "/rss") {
    res.setHeader("Content-Type", "application/rss+xml");
    res.end(`<rss><channel><item><title>[모의] Bitcoin market quiet ahead of data</title><link>http://127.0.0.1:${port}/rss#1</link><pubDate>${new Date(Date.now() - 3_600_000).toUTCString()}</pubDate></item></channel></rss>`);
    return;
  }
  if (req.url === "/chat/completions") {
    const sys = (JSON.parse(body) as { messages: { content: string }[] }).messages[0].content;
    const content = sys.includes("팀장")
      ? { reply: "네, 비트코인 4시간봉을 팀과 확인하겠습니다. (모의 LLM)", title: "BTC 4시간 점검", coin: "BTC", interval: "4h", mode: "trade" }
      : { stance: "neutral", summary: "모의 헤드라인 1건뿐이라 특별한 위험은 보이지 않습니다(1).", used: [1] };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ model: "mock-llm", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    return;
  }
  res.statusCode = 404;
  res.end();
}).listen(port, () => console.log(`mock desk on http://127.0.0.1:${port}`));
