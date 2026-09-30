import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-ivory px-3 py-1 text-sm text-espresso shadow-sm transition-all",
        "placeholder:text-espresso-300 focus-visible:border-[rgba(140,28,43,0.5)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
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
      "flex min-h-[80px] w-full rounded-md border border-input bg-ivory px-3 py-2 text-sm text-espresso shadow-sm transition-all",
      "placeholder:text-espresso-300 focus-visible:border-[rgba(140,28,43,0.5)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20",
      "disabled:cursor-not-allowed disabled:opacity-50",
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
      "flex h-9 w-full rounded-md border border-input bg-ivory px-2.5 text-sm text-espresso shadow-sm transition-all",
      "focus-visible:border-[rgba(140,28,43,0.5)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20 disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs font-medium text-espresso-700", className)}
      {...props}
    />
  );
}
