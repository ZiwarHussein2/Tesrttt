import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const userCount = await db.user.count();
  if (userCount === 0) redirect("/setup");
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return <LoginForm />;
}
