import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentContext } from "@/lib/auth";
import { Intro } from "@/components/intro";

async function IntroView() {
  const c = await currentContext();
  if (!c) redirect("/login");
  return <Intro ownerName={c.user.name} />;
}

export default function IntroPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stone-900" />}>
      <IntroView />
    </Suspense>
  );
}
