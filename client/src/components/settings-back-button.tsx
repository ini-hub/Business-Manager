import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

/**
 * Every settings section now lives at its own route (Settings Screen
 * Restructure follow-up - splitting the old Business/Store Settings tab
 * hubs into individually-breadcrumbed pages meant losing the one-click way
 * back to the settings list a tab bar gave for free). Drop this into a
 * PageHeader's `actions` on any page hanging directly off /settings.
 */
export function BackToSettingsButton() {
  return (
    <Button variant="outline" asChild data-testid="link-back-to-settings">
      <Link href="/settings">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Settings
      </Link>
    </Button>
  );
}
