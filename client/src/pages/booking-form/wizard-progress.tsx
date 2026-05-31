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
    <div className="relative">
      {/* Connector line */}
      <div className="absolute left-0 right-0 top-5 h-px bg-border hidden sm:block" />
      <ol className="relative z-10 flex justify-between gap-2">
        {WIZARD_STEPS.map((step, idx) => {
          const isCompleted = completedSteps.has(step.id);
          const isCurrent = step.id === currentStep;
          const isAccessible = idx <= currentIndex || isCompleted;

          return (
            <li key={step.id} className="flex flex-col items-center gap-2 flex-1">
              <button
                type="button"
                onClick={() => isAccessible && onStepClick(step.id)}
                disabled={!isAccessible}
                className={cn(
                  "h-10 w-10 rounded-full flex items-center justify-center border-2 text-sm font-semibold transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isCompleted &&
                    "bg-primary border-primary text-primary-foreground shadow-md shadow-primary/20",
                  isCurrent &&
                    !isCompleted &&
                    "bg-background border-primary text-primary shadow-md shadow-primary/20 ring-4 ring-primary/10",
                  !isCurrent &&
                    !isCompleted &&
                    "bg-muted border-muted-foreground/30 text-muted-foreground",
                  isAccessible && "cursor-pointer hover:opacity-80",
                  !isAccessible && "cursor-not-allowed opacity-50"
                )}
                aria-label={`Step ${idx + 1}: ${step.label}`}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isCompleted ? <Check className="h-5 w-5" /> : <span>{idx + 1}</span>}
              </button>
              <div className="text-center hidden sm:block">
                <p
                  className={cn(
                    "text-xs font-semibold leading-tight",
                    isCurrent ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </p>
                <p className="text-[10px] text-muted-foreground leading-tight hidden md:block">
                  {step.description}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
