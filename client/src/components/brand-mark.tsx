import { useId } from "react";
import { cn } from "@/lib/utils";
import "./brand-mark.css";

// The Kowope shopfront: awning, shop, rising bars. Replaces the old "K" tile everywhere.
// Static counterpart of the animated loader in ui/loader.tsx; exported files live in /brand.

const AWNING = "M3 4.6Q3 3 4.6 3H19.4Q21 3 21 4.6V8A3 3 0 0 1 15 8A3 3 0 0 1 9 8A3 3 0 0 1 3 8Z";

export type BrandTone = "auto" | "ink" | "blue" | "onDark";

type BrandMarkProps = {
  /** Fixed pixel size. Omit to use the responsive 28/32/36px steps. */
  size?: number;
  tone?: BrandTone;
  className?: string;
};

export function BrandMark({ size, tone = "auto", className }: BrandMarkProps) {
  const clipId = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn("bm", size === undefined && "bm-resp", className)}
      data-tone={tone === "auto" ? undefined : tone}
      aria-hidden="true"
      focusable="false"
    >
      <path d={AWNING} className="bm-awning" />
      <clipPath id={clipId}><path d={AWNING} /></clipPath>
      <rect x="9" y="2" width="6" height="12" className="bm-stripe" clipPath={`url(#${clipId})`} />
      <rect x="4" y="12" width="16" height="9" rx="1.6" className="bm-body" />
      <rect x="6.6" y="16.6" width="2.6" height="2.9" rx="0.5" className="bm-bar" />
      <rect x="10.7" y="15" width="2.6" height="4.5" rx="0.5" className="bm-bar" />
      <rect x="14.8" y="13.2" width="2.6" height="6.3" rx="0.5" className="bm-bar" />
    </svg>
  );
}

/** Mark plus the lowercase wordmark. The name always appears as "kowope" in the logo. */
export function BrandLogo({ size, tone, className }: BrandMarkProps) {
  return (
    <span className={cn("bm-logo", className)}>
      <BrandMark size={size} tone={tone} />
      <span className="bm-word">kowope</span>
    </span>
  );
}
