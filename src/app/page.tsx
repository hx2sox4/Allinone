import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentContext } from "@/lib/auth";

async function Gate(): Promise<never> {
  const c = await currentContext();
  if (!c) redirect("/login");
  redirect(c.brand ? "/office" : "/onboarding");
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Gate />
    </Suspense>
  );
}
