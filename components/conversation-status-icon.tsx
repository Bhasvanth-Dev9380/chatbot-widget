import { ArrowRightIcon, ArrowUpIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversationStatusIconProps {
  status: "unresolved" | "escalated" | "resolved";
};

const statusConfig = {
  resolved: {
    icon: CheckIcon,
    bgColor: "bg-[#3FB62F]",
  },
  unresolved: {
  icon: ArrowRightIcon,
  bgColor: "bg-destructive",
},
escalated: {
  icon: ArrowUpIcon,
  bgColor: "bg-yellow-500",
},
} as const;

export const ConversationStatusIcon = ({
  status,
}: ConversationStatusIconProps) => {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={cn(
      "flex items-center justify-center rounded-full p-2",
      config.bgColor,
    )}>
      <Icon className="size-3 stroke-3 text-white" />
    </div>
  );
};
