import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { SetupForm } from "./setup-form";

// The first-run check must run per request, never at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "System setup" };

export default async function SetupPage() {
  const userCount = await db.user.count();
  if (userCount > 0) redirect("/login");
  return <SetupForm />;
}
