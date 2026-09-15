import { redirect } from "next/navigation";
import { currentUser } from "@/lib/http";
import Login from "@/components/login";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (await currentUser()) redirect("/");
  return <Login />;
}
