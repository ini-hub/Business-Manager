import { createPortal } from "react-dom";
import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SpeedDialAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  testId?: string;
}

interface SpeedDialFABProps {
  actions: SpeedDialAction[];
}

export function SpeedDialFAB({ actions }: SpeedDialFABProps) {
  const [open, setOpen] = useState(false);

  if (actions.length === 0) return null;

  const handleAction = (onClick: () => void) => {
    setOpen(false);
    onClick();
  };

  return createPortal(
    <>
      {open && (
        <div
          className="fixed inset-0 z-[9990] bg-black/20 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end gap-3">
        {actions.map((action, index) => {
          const reverseIndex = actions.length - 1 - index;
          return (
            <div
              key={action.label}
              className={cn(
                "flex items-center gap-3 transition-all duration-200",
                open
                  ? "opacity-100 translate-y-0 pointer-events-auto"
                  : "opacity-0 translate-y-4 pointer-events-none"
              )}
              style={{
                transitionDelay: open
                  ? `${reverseIndex * 60}ms`
                  : `${index * 30}ms`,
              }}
            >
              <span className="bg-white dark:bg-gray-800 text-foreground text-sm font-medium px-3 py-1.5 rounded-full shadow-lg border border-border whitespace-nowrap select-none">
                {action.label}
              </span>
              <button
                data-testid={action.testId}
                onClick={() => handleAction(action.onClick)}
                className="h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-110 hover:bg-primary/90 transition-all duration-150 active:scale-95"
              >
                {action.icon}
              </button>
            </div>
          );
        })}

        <button
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "h-14 w-14 rounded-full bg-primary text-primary-foreground",
            "shadow-2xl shadow-primary/30 flex items-center justify-center",
            "hover:scale-105 hover:bg-primary/95 active:scale-95",
            "transition-all duration-200 border border-white/10"
          )}
          aria-label={open ? "Close speed dial" : "Open speed dial"}
        >
          <Plus
            className={cn(
              "h-6 w-6 transition-transform duration-300",
              open && "rotate-45"
            )}
          />
        </button>
      </div>
    </>,
    document.body
  );
}
