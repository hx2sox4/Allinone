import { Suspense } from "react";
import { redirect } from "next/navigation";
import { canEdit, currentContext } from "@/lib/auth";
import { TopNav } from "@/components/top-nav";
import { AccountView } from "@/components/account-view";

async function View() {
  const c = await currentContext();
  if (!c) redirect("/login");
  return <AccountView canEdit={canEdit(c.role)} />;
}

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <TopNav current="/account" title="모의 계좌" />
      <Suspense fallback={<p className="text-sm text-stone-500">계좌를 여는 중</p>}>
        <View />
      </Suspense>
    </main>
  );
}
