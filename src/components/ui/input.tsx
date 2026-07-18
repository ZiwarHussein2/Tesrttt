import * as React from "react";
import { cn } from "@/lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-md border border-hairline bg-canvas px-3 text-sm text-ink",
        "placeholder:text-mute transition-colors",
        "hover:border-hairline-strong focus:border-ink focus:outline-none",
        "disabled:cursor-not-allowed disabled:bg-canvas-soft-2 disabled:text-mute",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink",
      "placeholder:text-mute transition-colors min-h-[80px]",
      "hover:border-hairline-strong focus:border-ink focus:outline-none",
      "disabled:cursor-not-allowed disabled:bg-canvas-soft-2 disabled:text-mute",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-9 w-full appearance-none rounded-md border border-hairline bg-canvas px-3 pr-8 text-sm text-ink",
      "transition-colors cursor-pointer",
      "hover:border-hairline-strong focus:border-ink focus:outline-none",
      "disabled:cursor-not-allowed disabled:bg-canvas-soft-2 disabled:text-mute",
      "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23888%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[position:right_10px_center] bg-no-repeat",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({
  className,
  children,
  htmlFor,
  required,
}: {
  className?: string;
  children: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1.5 block text-[13px] font-medium text-ink", className)}>
      {children}
      {required && <span className="ml-0.5 text-critical" aria-hidden>*</span>}
    </label>
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="mt-1 text-[12px] text-critical-deep">{children}</p>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[12px] text-mute">{children}</p>;
}
