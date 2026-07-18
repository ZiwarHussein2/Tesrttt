import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// The first-run check must run per request, never at build time.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const userCount = await db.user.count();
  if (userCount === 0) redirect("/setup");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect("/dashboard");
}
