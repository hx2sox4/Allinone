import { currentContext } from "@/lib/auth";
import { officeState } from "@/lib/office";

export async function GET() {
  const c = await currentContext();
  if (!c) return new Response("unauthorized", { status: 401 });
  return Response.json(await officeState(c.workspace.id, { refresh: true }));
}
