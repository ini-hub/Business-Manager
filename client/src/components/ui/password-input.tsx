import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Eye, EyeOff, Check, X } from "lucide-react";

export interface PasswordInputProps extends React.ComponentProps<"input"> {
  error?: boolean;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, error, ...props }, ref) => {
    const [showPassword, setShowPassword] = React.useState(false);

    return (
      <div className="relative w-full">
        <Input
          type={showPassword ? "text" : "password"}
          className={cn("pr-10", className, error && "border-destructive focus-visible:ring-destructive")}
          ref={ref}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none transition-colors"
          tabIndex={-1}
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";

export interface PasswordChecklistProps {
  password?: string;
  confirmPassword?: string;
  className?: string;
  onValidationChange?: (isValid: boolean) => void;
}

export function PasswordChecklist({
  password = "",
  confirmPassword,
  className,
  onValidationChange,
}: PasswordChecklistProps) {
  const rules = React.useMemo(() => {
    return [
      {
        id: "length",
        label: "At least 8 characters",
        test: (pwd: string) => pwd.length >= 8,
      },
      {
        id: "uppercase",
        label: "One uppercase letter (A-Z)",
        test: (pwd: string) => /[A-Z]/.test(pwd),
      },
      {
        id: "lowercase",
        label: "One lowercase letter (a-z)",
        test: (pwd: string) => /[a-z]/.test(pwd),
      },
      {
        id: "number",
        label: "One number (0-9)",
        test: (pwd: string) => /[0-9]/.test(pwd),
      },
      {
        id: "special",
        label: "One special character (e.g. @, #, $, %, etc.)",
        test: (pwd: string) => /[^A-Za-z0-9]/.test(pwd),
      },
      {
        id: "nospace",
        label: "No spaces / spaces not allowed",
        test: (pwd: string) => !/\s/.test(pwd),
      },
    ];
  }, []);

  const matches = confirmPassword !== undefined ? password === confirmPassword && password !== "" : true;

  const results = React.useMemo(() => {
    return rules.map((r) => ({
      ...r,
      passed: r.test(password),
    }));
  }, [password, rules]);

  const allPassed = React.useMemo(() => {
    return results.every((r) => r.passed) && matches;
  }, [results, matches]);

  React.useEffect(() => {
    if (onValidationChange) {
      onValidationChange(allPassed);
    }
  }, [allPassed, onValidationChange]);

  return (
    <div className={cn("space-y-2 text-sm p-4 rounded-lg bg-card border shadow-sm", className)}>
      <p className="font-semibold text-foreground">Password Security Requirements:</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
        {results.map((r) => (
          <div
            key={r.id}
            className={cn(
              "flex items-center space-x-2 transition-all duration-300",
              password
                ? r.passed
                  ? "text-emerald-500 font-medium"
                  : "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {password ? (
              r.passed ? (
                <Check className="h-4 w-4 shrink-0 transition-transform scale-110" />
              ) : (
                <X className="h-4 w-4 shrink-0" />
              )
            ) : (
              <div className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0 ml-1.5 mr-1" />
            )}
            <span className="text-xs transition-colors">{r.label}</span>
          </div>
        ))}
      </div>

      {confirmPassword !== undefined && (
        <div
          className={cn(
            "flex items-center space-x-2 border-t pt-2 mt-2 transition-colors duration-300",
            confirmPassword
              ? matches
                ? "text-emerald-500 font-medium"
                : "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {confirmPassword ? (
            matches ? (
              <Check className="h-4 w-4 shrink-0 transition-transform scale-110" />
            ) : (
              <X className="h-4 w-4 shrink-0" />
            )
          ) : (
            <div className="h-2 w-2 rounded-full bg-muted-foreground/30 shrink-0 ml-1.5 mr-1" />
          )}
          <span className="text-xs">Passwords match</span>
        </div>
      )}
    </div>
  );
}

export { PasswordInput };
