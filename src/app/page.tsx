import { redirect } from "next/navigation";
import { currentUser } from "@/lib/http";
import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const user = await currentUser();
  if (!user) {
    // Come back to the linked task or page after signing in.
    const query = new URLSearchParams(
      Object.entries({ page: one(params.page), task: one(params.task) }).filter((e): e is [string, string] => !!e[1]),
    ).toString();
    redirect(query ? `/login?next=${encodeURIComponent(`/?${query}`)}` : "/login");
  }
  return <Workspace initialUser={user} initialPage={one(params.page)} initialTask={one(params.task)} />;
}
