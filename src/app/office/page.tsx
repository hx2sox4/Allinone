import { Suspense } from "react";
import { redirect } from "next/navigation";
import { canEdit, currentContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { OfficeApp } from "@/components/bureau/OfficeApp";

async function OfficeView() {
  const c = await currentContext();
  if (!c) redirect("/login");
  const rows = await db.mission.findMany({ where: { workspaceId: c.workspace.id }, orderBy: { createdAt: "desc" }, take: 30 });
  const missions = rows.map((m) => ({ id: m.id, title: m.title, prompt: m.prompt, status: m.status, createdAt: m.createdAt.getTime(), endedAt: m.endedAt?.getTime() ?? null }));
  const llmModel = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY ? (process.env.LLM_MODEL ?? "deepseek-flash") : "";
  return <OfficeApp canEdit={canEdit(c.role)} llmModel={llmModel} initialMissions={missions} />;
}

export default function OfficePage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-stone-500">사무실 문을 여는 중</p>}>
      <OfficeView />
    </Suspense>
  );
}
