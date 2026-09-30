import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-champagne-100 text-espresso-700",
        gold: "border-gold-700/25 bg-gold/20 text-gold-700",
        outline: "border-border text-espresso-500",
        success: "border-transparent bg-emerald-50 text-emerald-600",
        danger: "border-transparent bg-danger-50 text-danger-600",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
