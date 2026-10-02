import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MapPinOff } from "lucide-react";

// Webviews inside WhatsApp/Instagram/Facebook etc. refuse geolocation no matter
// what the phone's settings say, so "allow it for this site" cannot work there.
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|; wv\)|Snapchat|TikTok|Twitter/i.test(navigator.userAgent);
}

type Platform = "in-app" | "ios-safari" | "ios-other" | "android" | "mac-safari" | "desktop";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  if (isInAppBrowser()) return "in-app";
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, so check for touch.
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (isIos) return /CriOS|FxiOS|EdgiOS/.test(ua) ? "ios-other" : "ios-safari";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return "mac-safari";
  return "desktop";
}

const GUIDES: Record<Platform, { title: string; steps: string[] }> = {
  "in-app": {
    title: "Open this page in your browser",
    steps: [
      "This app's built-in browser can't share your location.",
      "Tap the menu (⋮ or ⋯) and choose “Open in browser”.",
      "Sign in again in Chrome or Safari.",
    ],
  },
  "ios-safari": {
    title: "Turn on location for Safari",
    steps: [
      "Open Settings > Privacy & Security > Location Services.",
      "Make sure Location Services is switched on at the top.",
      "Scroll down, tap Safari (Websites), and choose While Using the App.",
      "Still blocked afterwards? Reload this page.",
    ],
  },
  "ios-other": {
    title: "Turn on location for your browser",
    steps: [
      "Open Settings > Privacy & Security > Location Services.",
      "Make sure Location Services is switched on at the top.",
      "Scroll down, tap your browser (Chrome, Firefox or Edge), and choose While Using the App.",
      "Still blocked afterwards? Reload this page.",
    ],
  },
  android: {
    title: "Turn on location for your browser",
    steps: [
      "Swipe down and make sure Location is switched on.",
      "Tap the lock or tune icon beside the web address, then Permissions, and set Location to Allow.",
      "Still blocked afterwards? Reload this page.",
    ],
  },
  "mac-safari": {
    title: "Turn on location for Safari",
    steps: [
      "Open System Settings > Privacy & Security > Location Services.",
      "Make sure Location Services is switched on at the top.",
      "Scroll down and switch on Safari.",
      "In Safari, choose Safari > Settings > Websites > Location and set this site to Allow.",
      "Still blocked afterwards? Reload this page.",
    ],
  },
  desktop: {
    title: "Turn on location for this site",
    steps: [
      "Click the lock or tune icon beside the web address and set Location to Allow.",
      "Make sure location is switched on in your computer's system settings too.",
      "Still blocked afterwards? Reload this page.",
    ],
  },
};

/** Step-by-step help for a blocked location permission, tailored to the device. */
export function LocationHelp({ className }: { className?: string }) {
  const guide = GUIDES[detectPlatform()];
  return (
    <Alert className={className} data-testid="alert-location-help">
      <MapPinOff className="h-4 w-4" />
      <AlertTitle>{guide.title}</AlertTitle>
      <AlertDescription>
        <ol className="mt-1 list-decimal space-y-1 pl-4">
          {guide.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </AlertDescription>
    </Alert>
  );
}
