import Link from "next/link";
import { logout } from "@/app/actions";

const LINKS = [
  { href: "/office", label: "사무실" },
  { href: "/account", label: "모의 계좌" },
];

export function TopNav({ current, title }: { current: string; title: string }) {
  return (
    <header className="mb-5">
      <p className="text-sm font-semibold text-emerald-700">일손 트레이딩 데스크</p>
      <h1 className="text-2xl font-bold">{title}</h1>
      <nav className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm" aria-label="주 메뉴">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={current === l.href ? "page" : undefined} className={`rounded-full px-3 py-1.5 font-semibold ${current === l.href ? "bg-emerald-700 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200"}`}>
            {l.label}
          </Link>
        ))}
        <form action={logout} className="ml-auto"><button className="px-2 py-1.5 text-stone-600 underline">로그아웃</button></form>
      </nav>
    </header>
  );
}
