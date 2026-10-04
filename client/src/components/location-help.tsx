import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { MapPinOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Webviews inside WhatsApp/Instagram/Facebook etc. refuse geolocation no matter
// what the phone's settings say, so "allow it for this site" cannot work there.
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|; wv\)|Snapchat|TikTok|Twitter/i.test(navigator.userAgent);
}

type Env =
  | "in-app"
  | "ios-safari"
  | "ios-other"
  | "android"
  | "mac-safari"
  | "desktop-firefox"
  | "desktop-chromium";

function detectEnv(): Env {
  if (typeof navigator === "undefined") return "desktop-chromium";
  if (isInAppBrowser()) return "in-app";
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, so check for touch.
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isIos) return /CriOS|FxiOS|EdgiOS/.test(ua) ? "ios-other" : "ios-safari";
  if (/Android/.test(ua)) return "android";
  if (/Firefox/.test(ua)) return "desktop-firefox";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return "mac-safari";
  return "desktop-chromium";
}

type Guide = {
  /** The browser blocked just this site. Fixing it never needs the phone's settings. */
  site: string[];
  /** The whole device or browser app has location off. */
  device: string[];
};

const RELOAD = "Come back here and reload this page.";

const GUIDES: Record<Exclude<Env, "in-app">, Guide> = {
  "ios-safari": {
    site: [
      "Tap the aA (or page settings) icon in the address bar.",
      "Tap Website Settings, then Location, and choose Allow.",
      RELOAD,
    ],
    device: [
      "Open Settings > Privacy & Security > Location Services.",
      "Make sure Location Services is switched on at the top.",
      "Scroll down, tap Safari (Websites), and choose While Using the App.",
      RELOAD,
    ],
  },
  "ios-other": {
    site: [
      "Tap the lock or info icon beside the web address.",
      "Open Permissions, set Location to Allow.",
      RELOAD,
    ],
    device: [
      "Open Settings > Privacy & Security > Location Services.",
      "Make sure Location Services is switched on at the top.",
      "Scroll down, tap your browser (Chrome, Firefox or Edge), and choose While Using the App.",
      RELOAD,
    ],
  },
  android: {
    site: [
      "Tap the lock or tune icon beside the web address.",
      "Tap Permissions, then set Location to Allow.",
      RELOAD,
    ],
    device: [
      "Swipe down from the top and make sure Location is switched on.",
      "Open Settings > Apps > your browser > Permissions > Location and choose Allow while using the app.",
      RELOAD,
    ],
  },
  "mac-safari": {
    site: [
      "In Safari, choose Safari > Settings > Websites > Location.",
      "Find this site in the list and set it to Allow.",
      RELOAD,
    ],
    device: [
      "Open System Settings > Privacy & Security > Location Services.",
      "Make sure Location Services is switched on at the top.",
      "Scroll down and switch on Safari.",
      RELOAD,
    ],
  },
  "desktop-firefox": {
    site: [
      "Click the permissions icon on the left of the address bar.",
      "Next to “Access your location”, click the X to clear the block.",
      RELOAD,
    ],
    device: [
      "Make sure location is switched on in your computer's system settings.",
      "On Windows: Settings > Privacy & security > Location. On Mac: System Settings > Privacy & Security > Location Services.",
      RELOAD,
    ],
  },
  "desktop-chromium": {
    site: [
      "Click the lock or tune icon on the left of the address bar.",
      "Set Location to Allow (or choose Site settings > Location > Allow).",
      RELOAD,
    ],
    device: [
      "Make sure location is switched on in your computer's system settings.",
      "On Windows: Settings > Privacy & security > Location. On Mac: System Settings > Privacy & Security > Location Services.",
      RELOAD,
    ],
  },
};

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm">
      {steps.map((s) => <li key={s}>{s}</li>)}
    </ol>
  );
}

function GuideBody({ env }: { env: Env }) {
  if (env === "in-app") {
    return (
      <div className="space-y-3">
        <p className="text-sm">This app's built-in browser can't share your location, whatever the settings say.</p>
        <Steps steps={[
          "Tap the menu (⋮ or ⋯) and choose “Open in browser”.",
          "Sign in again in Chrome or Safari.",
        ]} />
      </div>
    );
  }
  const guide = GUIDES[env];
  return (
    <Tabs defaultValue="site">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="site" data-testid="tab-location-site">This site is blocked</TabsTrigger>
        <TabsTrigger value="device" data-testid="tab-location-device">Device location is off</TabsTrigger>
      </TabsList>
      <TabsContent value="site" className="pt-3">
        <p className="mb-2 text-xs text-muted-foreground">Start here if you tapped “Don't allow” on the browser's popup.</p>
        <Steps steps={guide.site} />
      </TabsContent>
      <TabsContent value="device" className="pt-3">
        <p className="mb-2 text-xs text-muted-foreground">Try this if the site settings already say Allow.</p>
        <Steps steps={guide.device} />
      </TabsContent>
    </Tabs>
  );
}

/**
 * One line while location is blocked, with the full per-device guide a tap away:
 * a bottom sheet on phones, a dialog on larger screens. Keeps the card compact.
 */
export function LocationHelp({
  className,
  onCheckAgain,
  placeName,
}: {
  className?: string;
  /** When given, renders the full blocked-location banner with a retry button. */
  onCheckAgain?: () => void;
  /** Where the clock-in is checked, e.g. the branch name. */
  placeName?: string;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const env = detectEnv();
  const title = env === "in-app" ? "Open this page in your browser" : "Turn location back on";
  const blurb = "Follow the steps for your device.";

  const banner = onCheckAgain ? (
    <div
      className={cn("rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950 sm:p-4", className)}
      data-testid="alert-location-help"
    >
      <div className="flex gap-3">
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 sm:flex">
          <MapPinOff className="h-4 w-4 text-amber-800" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <MapPinOff className="h-4 w-4 text-amber-800 sm:hidden" />
            {env === "in-app" ? "Location can't be shared here" : "Location access is blocked"}
          </p>
          <p className="mt-1 text-sm text-amber-900/80">
            <span className="sm:hidden">
              Clock-in uses your location to confirm you are at the branch. Allow location for this site, then check again.
            </span>
            <span className="hidden sm:inline">
              Clock-in uses your location to confirm you are at the {placeName ? `${placeName} ` : ""}branch.
              Allow location for this site in your browser settings, then check again.
            </span>
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            <Button
              size="sm"
              className="bg-amber-800 text-white hover:bg-amber-900"
              onClick={onCheckAgain}
              data-testid="button-retry-location"
            >
              <RefreshCw className="mr-2 hidden h-3.5 w-3.5 sm:block" /> Check again
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-amber-300 bg-white text-amber-950 hover:bg-amber-50"
              onClick={() => setOpen(true)}
              data-testid="button-location-how-to-fix"
            >
              <span className="sm:hidden">How to fix</span>
              <span className="hidden sm:inline">How to allow location</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  ) : (
    <Alert className={className} data-testid="alert-location-help">
      <MapPinOff className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-3">
        <span>Location is blocked.</span>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="button-location-how-to-fix">
          How to fix
        </Button>
      </AlertDescription>
    </Alert>
  );

  return (
    <>
      {banner}

      {isMobile ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent data-testid="sheet-location-help">
            <DrawerHeader className="text-left">
              <DrawerTitle>{title}</DrawerTitle>
              <DrawerDescription>{blurb}</DrawerDescription>
            </DrawerHeader>
            <div className="max-h-[60vh] overflow-y-auto px-4 pb-6">
              <GuideBody env={env} />
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md" data-testid="dialog-location-help">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{blurb}</DialogDescription>
            </DialogHeader>
            <GuideBody env={env} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
