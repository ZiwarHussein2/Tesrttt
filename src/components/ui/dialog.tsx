"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, type ButtonProps } from "@/components/ui/button";
import { FieldError } from "@/components/ui/input";
import type { ActionState } from "@/lib/action-state";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/35" aria-label="Close dialog" onClick={onClose} />
      <div
        className={cn(
          "relative max-h-[92vh] w-full overflow-y-auto thin-scroll rounded-t-xl bg-canvas p-5 shadow-modal sm:m-4 sm:rounded-xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.3px] text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[12.5px] leading-relaxed text-body">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-mute hover:bg-canvas-soft-2 hover:text-ink">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// A button that opens a modal containing a form bound to a server action.
// Closes automatically when the action reports success.
export function ActionDialog({
  trigger,
  triggerVariant = "secondary",
  triggerSize = "md",
  triggerClassName,
  title,
  description,
  action,
  submitLabel = "Save",
  destructive,
  wide,
  children,
}: {
  trigger: React.ReactNode;
  triggerVariant?: ButtonProps["variant"];
  triggerSize?: ButtonProps["size"];
  triggerClassName?: string;
  title: string;
  description?: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel?: string;
  destructive?: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} className={triggerClassName} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      {open && (
        <DialogForm
          title={title}
          description={description}
          action={action}
          submitLabel={submitLabel}
          destructive={destructive}
          wide={wide}
          onClose={() => setOpen(false)}
        >
          {children}
        </DialogForm>
      )}
    </>
  );
}

function DialogForm({
  title,
  description,
  action,
  submitLabel,
  destructive,
  wide,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  submitLabel: string;
  destructive?: boolean;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = React.useActionState<ActionState, FormData>(action, {});

  React.useEffect(() => {
    if (state.success) onClose();
  }, [state.success, onClose]);

  return (
    <Modal open onClose={onClose} title={title} description={description} wide={wide}>
      <form action={formAction} className="space-y-4" noValidate>
        {children}
        <FieldError>{state.error}</FieldError>
        <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={destructive ? "danger" : "primary"} disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// Inline action button (no fields) with optional confirmation + reason capture.
export function ActionButton({
  label,
  action,
  variant = "secondary",
  size = "sm",
  confirmTitle,
  confirmDescription,
  requireReason,
  reasonLabel = "Reason",
  hidden,
  className,
}: {
  label: React.ReactNode;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  confirmTitle?: string;
  confirmDescription?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  hidden?: Record<string, string>;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = React.useActionState<ActionState, FormData>(action, {});

  React.useEffect(() => {
    if (state.success) setOpen(false);
  }, [state.success]);

  const hiddenInputs = Object.entries(hidden ?? {}).map(([k, v]) => (
    <input key={k} type="hidden" name={k} value={v} />
  ));

  if (!confirmTitle && !requireReason) {
    return (
      <form action={formAction} className="inline">
        {hiddenInputs}
        <Button type="submit" variant={variant} size={size} disabled={pending} className={className}>
          {pending ? "…" : label}
        </Button>
        {state.error && <span role="alert" className="ml-2 text-[12px] text-critical-deep">{state.error}</span>}
      </form>
    );
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className={className}>
        {label}
      </Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={confirmTitle ?? "Confirm"} description={confirmDescription}>
          <form action={formAction} className="space-y-4">
            {hiddenInputs}
            {requireReason && (
              <div>
                <label htmlFor="action-reason" className="mb-1.5 block text-[13px] font-medium text-ink">
                  {reasonLabel}
                  <span className="ml-0.5 text-critical" aria-hidden>*</span>
                </label>
                <textarea
                  id="action-reason"
                  name="reason"
                  required
                  className="min-h-[70px] w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-mute focus:border-ink focus:outline-none"
                  placeholder="Recorded in the audit log."
                />
              </div>
            )}
            <FieldError>{state.error}</FieldError>
            <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" variant={variant === "danger" ? "danger" : "primary"} disabled={pending}>
                {pending ? "Working…" : label}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
