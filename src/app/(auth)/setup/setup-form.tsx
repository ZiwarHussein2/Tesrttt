"use client";

import { useActionState } from "react";
import { setupAction, type SetupState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError, Hint } from "@/components/ui/input";

export function SetupForm() {
  const [state, formAction, pending] = useActionState<SetupState, FormData>(setupAction, {});

  return (
    <div className="w-full max-w-md rounded-xl bg-canvas p-8 shadow-float">
      <h1 className="text-lg font-semibold tracking-[-0.6px] text-ink">Set up Merna Control Center.</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-body">
        This is the first run. Create the company record and the Super Admin account.
        Branches, departments and users are added afterwards from inside the panel.
      </p>
      <form action={formAction} className="mt-6 space-y-4" noValidate>
        <div>
          <Label htmlFor="companyName" required>Company name</Label>
          <Input id="companyName" name="companyName" placeholder="Merna Medical Company" required autoFocus />
        </div>
        <div>
          <Label htmlFor="legalName">Legal entity name</Label>
          <Input id="legalName" name="legalName" placeholder="Merna Medical Company Ltd." />
          <Hint>Optional — used on formal reports and documents.</Hint>
        </div>
        <div className="border-t border-hairline pt-4">
          <Label htmlFor="adminName" required>Your full name</Label>
          <Input id="adminName" name="adminName" placeholder="Full name" required />
        </div>
        <div>
          <Label htmlFor="email" required>Admin email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" placeholder="admin@merna.example" required />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="password" required>Password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </div>
          <div>
            <Label htmlFor="confirmPassword" required>Confirm password</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
          </div>
        </div>
        <Hint>At least 10 characters, with a lowercase letter and an uppercase letter or digit.</Hint>
        <FieldError>{state.error}</FieldError>
        <Button type="submit" variant="primary" size="lg" className="w-full justify-center" disabled={pending}>
          {pending ? "Creating…" : "Create company & admin account"}
        </Button>
      </form>
    </div>
  );
}
