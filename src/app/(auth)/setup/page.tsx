import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "System setup" };

export default async function SetupPage() {
  const userCount = await db.user.count();
  if (userCount > 0) redirect("/login");
  return <SetupForm />;
}
