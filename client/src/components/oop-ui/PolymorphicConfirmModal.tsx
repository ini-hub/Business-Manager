import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PolymorphicButton } from "./PolymorphicButton";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PolymorphicConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void | Promise<void>;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  isPending?: boolean;
  variant?: "warning" | "danger" | "info";
}

export const PolymorphicConfirmModal: React.FC<PolymorphicConfirmModalProps> = ({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDestructive = false,
  isPending = false,
  variant = "info",
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {variant === "danger" || variant === "warning" ? (
              <div className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                variant === "danger" ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
              )}>
                <AlertTriangle className="h-5 w-5" />
              </div>
            ) : null}
            <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-sm text-muted-foreground leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 gap-2 sm:gap-0">
          <PolymorphicButton
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {cancelText}
          </PolymorphicButton>
          <PolymorphicButton
            variant={isDestructive || variant === "danger" ? "destructive" : "default"}
            onClick={async () => {
              await onConfirm();
            }}
            disabled={isPending}
          >
            {isPending ? "Processing..." : confirmText}
          </PolymorphicButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
