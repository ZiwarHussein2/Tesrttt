import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "ai";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary/85",
  secondary:
    "bg-canvas text-ink border border-hairline hover:border-hairline-strong hover:bg-canvas-soft disabled:text-mute",
  ghost: "bg-transparent text-body hover:bg-canvas-soft-2 hover:text-ink",
  danger:
    "bg-canvas text-critical-deep border border-critical-soft hover:border-critical hover:bg-critical-soft/40",
  ai: "bg-ai text-white hover:bg-ai/85",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
  icon: "h-8 w-8 justify-center",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center rounded-md font-medium transition-colors select-none",
        "disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer whitespace-nowrap",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
