"use client";
import { cn } from "@/lib/utils";
import { useAtomValue } from "jotai";
import { widgetSettingsAtom } from "@/modules/widget/atoms/widget-atoms";

export const WidgetHeader = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  const widgetSettings = useAtomValue(widgetSettingsAtom);
  const customColor = widgetSettings?.appearance?.primaryColor;

  return (
    <header 
      className={cn(
        "p-4 text-primary-foreground",
        !customColor && "bg-primary",
        className,
      )}
      style={customColor ? { backgroundColor: customColor } : undefined}
    >
      {children}
    </header>
  );
};
