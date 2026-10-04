import { BackButton } from "@/components/back-button";

/**
 * Every settings section lives at its own route, so pages hanging directly off
 * /settings need a one-click way back to the settings list. Drop this into a
 * PageHeader's `actions`.
 */
export function BackToSettingsButton() {
  return <BackButton label="Settings" href="/settings" data-testid="link-back-to-settings" />;
}
