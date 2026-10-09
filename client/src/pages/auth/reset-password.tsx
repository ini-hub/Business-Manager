import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";

/**
 * Password reset now happens in one place (forgot-password.tsx, steps 2-4).
 * This route stays so existing links to /auth/reset-password?emailOrPhone=...
 * keep working: they land on the "enter your code" step.
 */
export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(useSearch());
  const identifier = params.get("emailOrPhone") || params.get("email") || "";

  useEffect(() => {
    setLocation(
      identifier
        ? `/auth/forgot-password?identifier=${encodeURIComponent(identifier)}&step=code`
        : "/auth/forgot-password",
      { replace: true },
    );
  }, [identifier, setLocation]);

  return null;
}
