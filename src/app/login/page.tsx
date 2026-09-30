import { redirect } from "next/navigation";
import { currentUser } from "@/lib/http";
import { safeNext } from "@/lib/client";
import Login from "@/components/login";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const target = safeNext(Array.isArray(next) ? next[0] : next);
  if (await currentUser()) redirect(target);
  return <Login next={target} />;
}
