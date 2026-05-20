import { PolymorphicConfirmModal } from "./oop-ui/PolymorphicConfirmModal";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  isDestructive?: boolean;
  isLoading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  onConfirm,
  isDestructive = false,
  isLoading = false,
}: ConfirmDialogProps) {
  return (
    <PolymorphicConfirmModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      onConfirm={onConfirm}
      confirmText={confirmText}
      cancelText={cancelText}
      isDestructive={isDestructive}
      isPending={isLoading}
      variant={isDestructive ? "danger" : "info"}
    />
  );
}
