// 뉴스 헤드라인 수집. RSS 제목과 링크, 시각만 쓴다(본문을 복제하지 않음).
// 기본 피드 주소는 각 사이트가 공개한 RSS 주소이며, 이 저장소의 클라우드 환경에서는 막혀 있어 사용자 PC에서 확인해야 한다.
export interface Headline { title: string; link: string; source: string; at: number }

export const DEFAULT_FEEDS = ["https://www.coindesk.com/arc/outboundfeeds/rss/", "https://cointelegraph.com/rss"];
export const feedsFromEnv = () => (process.env.NEWS_FEEDS ? process.env.NEWS_FEEDS.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_FEEDS);

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, "").trim();
const tag = (block: string, name: string) => decode(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "");

export function parseRss(xml: string, source: string): Headline[] {
  const out: Headline[] = [];
  for (const m of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const b = m[0];
    const title = tag(b, "title");
    const at = Date.parse(tag(b, "pubDate") || tag(b, "dc:date"));
    if (title && Number.isFinite(at)) out.push({ title, link: tag(b, "link"), source, at });
  }
  return out;
}

/** 지난 hours시간 안의 헤드라인 중 키워드가 들어간 것. 피드 하나가 실패해도 나머지로 진행하고 실패를 알려 준다. */
export async function recentHeadlines(keywords: string[], opts: { feeds?: string[]; hours?: number; now?: number; fetchImpl?: typeof fetch; limit?: number } = {}): Promise<{ items: Headline[]; failed: string[] }> {
  const feeds = opts.feeds ?? feedsFromEnv();
  const f = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();
  const since = now - (opts.hours ?? 24) * 3_600_000;
  const failed: string[] = [];
  const all: Headline[] = [];
  await Promise.all(feeds.map(async (url) => {
    try {
      const res = await f(url, { headers: { "User-Agent": "ilson-desk/0.1" }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(String(res.status));
      all.push(...parseRss(await res.text(), new URL(url).hostname.replace(/^www\./, "")));
    } catch {
      failed.push(url);
    }
  }));
  const words = keywords.map((k) => k.toLowerCase());
  const hit = (t: string) => words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t));
  const seen = new Set<string>();
  const items = all
    .filter((h) => h.at >= since && h.at <= now + 600_000 && hit(h.title))
    .sort((a, b) => b.at - a.at)
    .filter((h) => (seen.has(h.title) ? false : (seen.add(h.title), true)))
    .slice(0, opts.limit ?? 15);
  return { items, failed };
}
