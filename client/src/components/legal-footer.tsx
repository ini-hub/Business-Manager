import { Link } from "wouter";

/**
 * Minimal footer for the auth-adjacent pages (Landing, Signup, Login) - no
 * footer existed anywhere in the app before this. Just enough to make the
 * legal documents discoverable outside the signup checkbox.
 */
export function LegalFooter() {
  return (
    <footer className="w-full py-6 text-center text-xs text-muted-foreground">
      <nav className="flex items-center justify-center gap-4 flex-wrap">
        <Link href="/terms" className="hover:text-foreground hover:underline">
          Terms and Conditions
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/privacy" className="hover:text-foreground hover:underline">
          Privacy Policy
        </Link>
        <span aria-hidden="true">·</span>
        <Link href="/data-usage" className="hover:text-foreground hover:underline">
          Data Usage Policy
        </Link>
      </nav>
    </footer>
  );
}

export default LegalFooter;
