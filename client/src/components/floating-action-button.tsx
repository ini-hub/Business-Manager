import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingActionButtonProps {
  onClick: () => void;
  label?: string;
  testId?: string;
  className?: string;
}

export function FloatingActionButton({
  onClick,
  label = "Quick Add",
  testId,
  className,
}: FloatingActionButtonProps) {
  return createPortal(
    <Button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "fixed bottom-6 right-6 z-[9999] rounded-full h-12 px-5 shadow-2xl transition-all duration-300 transform ease-in-out hover:scale-105 hover:-translate-y-0.5",
        "bg-primary hover:bg-primary/95 text-primary-foreground font-semibold flex items-center gap-2",
        "border border-white/10 dark:border-white/5 shadow-primary/20",
        className
      )}
    >
      <Plus className="h-5 w-5 animate-pulse" />
      <span className="text-sm tracking-wide font-bold">{label}</span>
    </Button>,
    document.body
  );
}
