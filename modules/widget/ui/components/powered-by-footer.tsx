"use client";

import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

export const PoweredByFooter = ({ className }: Props) => {
  return (
    <div
      className={cn(
        "border-t bg-background px-3 py-1 text-center text-[11px] text-muted-foreground",
        className
      )}
    >
      <a
        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        href="https://spinabot.com"
        rel="noreferrer"
        target="_blank"
      >
        <span>Powered by</span>
        <span className="font-medium text-foreground">Spinabot</span>
      </a>
    </div>
  );
};
