import { cn } from "@/lib/utils";

interface TypingIndicatorProps {
  className?: string;
}

export const TypingIndicator = ({ className }: TypingIndicatorProps) => {
  return (
    <div className={cn("flex items-center gap-1 py-2", className)}>
      <div className="flex gap-1">
        <span
          className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: '-0.3s' }}
        />
        <span
          className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: '-0.15s' }}
        />
        <span className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" />
      </div>
    </div>
  );
};
