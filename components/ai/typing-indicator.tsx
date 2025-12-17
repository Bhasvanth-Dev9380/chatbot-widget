import { cn } from "@/lib/utils";

interface TypingIndicatorProps {
  className?: string;
}

export const TypingIndicator = ({ className }: TypingIndicatorProps) => {
  return (
    <div className={cn("flex items-center gap-1 py-0.5", className)}>
      <span
        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
        style={{ animationDelay: '0ms', animationDuration: '700ms' }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
        style={{ animationDelay: '150ms', animationDuration: '700ms' }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
        style={{ animationDelay: '300ms', animationDuration: '700ms' }}
      />
    </div>
  );
};
