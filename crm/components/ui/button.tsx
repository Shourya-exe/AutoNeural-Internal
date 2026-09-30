import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "btn-sheen border border-[#8A1226]/35 bg-gradient-to-b from-[#8C1C2B] to-[#5E0D18] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_24px_-10px_rgba(140,28,43,0.7)] hover:from-[#A32133] hover:to-[#6E1020] hover:shadow-glow",
        gold:
          "btn-sheen border border-[#8A1226]/35 bg-gradient-to-b from-[#8C1C2B] to-[#5E0D18] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_10px_30px_-10px_rgba(140,28,43,0.8)] hover:from-[#A32133] hover:to-[#6E1020] hover:shadow-glow",
        outline:
          "border border-input bg-surface text-espresso-700 hover:border-[rgba(140,28,43,0.35)] hover:bg-accent hover:text-espresso",
        secondary: "bg-champagne-100 text-espresso-700 hover:bg-champagne-200",
        ghost: "text-espresso-700 hover:bg-accent hover:text-espresso",
        danger:
          "border border-white/10 bg-gradient-to-b from-[#E04356] to-[#9C1F31] text-white hover:from-[#EE5467] hover:to-[#AE2537]",
        link: "text-gold-700 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
