"use client";
import { cn } from "@/lib/utils";

export const WidgetHeader = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <header
      className={cn("p-4 text-primary-foreground shadow-sm", className)}
      style={{ background: "var(--primary-bg)" }}
    >
      {children}
    </header>
  );
};
