import { WizardStep, WIZARD_STEPS } from "./types";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface WizardProgressProps {
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
  onStepClick: (step: WizardStep) => void;
}

export function WizardProgress({ currentStep, completedSteps, onStepClick }: WizardProgressProps) {
  const currentIndex = WIZARD_STEPS.findIndex((s) => s.id === currentStep);

  return (
    <ol aria-label="Booking steps" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {WIZARD_STEPS.map((step, idx) => {
        const isCompleted = completedSteps.has(step.id);
        const isCurrent = step.id === currentStep;
        const isAccessible = idx <= currentIndex || isCompleted;

        return (
          <li key={step.id}>
            <button
              type="button"
              onClick={() => isAccessible && onStepClick(step.id)}
              disabled={!isAccessible}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "w-full flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left bg-card transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                isCurrent ? "border-2 border-primary" : "border-border",
                isAccessible ? "cursor-pointer hover:border-primary/50" : "cursor-not-allowed opacity-60"
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  isCompleted
                    ? "bg-emerald-600 text-white"
                    : isCurrent
                    ? "bg-primary text-primary-foreground"
                    : "border-[1.5px] border-muted-foreground/40 text-muted-foreground"
                )}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : idx + 1}
              </span>
              <span className="flex flex-col min-w-0">
                <span
                  className={cn(
                    "text-sm leading-tight truncate",
                    isCurrent ? "font-bold text-foreground" : "font-semibold text-foreground/90"
                  )}
                >
                  {step.label}
                </span>
                <span className="text-xs text-muted-foreground leading-tight truncate hidden sm:block">
                  {step.description}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
