"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <div className="w-full max-w-sm rounded-xl bg-canvas p-8 shadow-float">
      <h1 className="text-lg font-semibold tracking-[-0.6px] text-ink">Sign in.</h1>
      <p className="mt-1 text-[13px] text-body">Access the Merna management panel.</p>
      <form action={formAction} className="mt-6 space-y-4" noValidate>
        <div>
          <Label htmlFor="email" required>Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@merna.example"
            required
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="password" required>Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
        </div>
        <FieldError>{state.error}</FieldError>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </div>
  );
}
