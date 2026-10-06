import { useEffect, useId, useState } from "react";
import { Loader2 as PlainSpinner } from "lucide-react";
import { cn } from "@/lib/utils";
import "./loader.css";

// Kowope loading mark: the shopfront builds itself (awning drops in, shop opens, bars grow).
// Sizes: 64-96px full screen, 22-32px inline. Below 20px the bars merge, so Spinner falls back to a
// plain spinner there. Colours follow the theme; inside a <button> the mark takes the button's text
// colour and --loader-bars (see button.tsx).

export type LoaderTone = "auto" | "onBrand" | "onDark" | "current";

const AWNING = "M3 4.6Q3 3 4.6 3H19.4Q21 3 21 4.6V8A3 3 0 0 1 15 8A3 3 0 0 1 9 8A3 3 0 0 1 3 8Z";

type MarkProps = {
  size?: number;
  tone?: LoaderTone;
  className?: string;
  /** Prefix of the animation classes: "kl" loops, "klr" plays once as part of the reveal. */
  anim?: "kl" | "klr";
};

function Mark({ size = 24, tone = "auto", className, anim = "kl" }: MarkProps) {
  const clipId = useId();
  const c = (n: string) => `${anim}-${n}`;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn("kl", className)}
      data-tone={tone === "auto" ? undefined : tone}
      aria-hidden="true"
      focusable="false"
    >
      <g className={c("a")}>
        <path d={AWNING} className="kl-awning-fill" />
        <clipPath id={clipId}><path d={AWNING} /></clipPath>
        <rect x="9" y="2" width="6" height="12" className="kl-stripe" clipPath={`url(#${clipId})`} />
      </g>
      <rect className={cn(c("bd"), "kl-body")} x="4" y="12" width="16" height="9" rx="1.6" />
      <rect className={cn(c("b1"), "kl-bar")} x="6.6" y="16.6" width="2.6" height="2.9" rx="0.5" />
      <rect className={cn(c("b2"), "kl-bar")} x="10.7" y="15" width="2.6" height="4.5" rx="0.5" />
      <rect className={cn(c("b3"), "kl-bar")} x="14.8" y="13.2" width="2.6" height="6.3" rx="0.5" />
    </svg>
  );
}

type LoaderProps = {
  size?: number;
  tone?: LoaderTone;
  /** Visible text under the mark. Without it the label is announced to screen readers only. */
  label?: string;
  className?: string;
};

/** The loading mark with role="status" and a text label. Use for sections and screens. */
export function Loader({ size = 32, tone = "auto", label = "Loading", className }: LoaderProps) {
  return (
    <span role="status" className={cn("inline-flex flex-col items-center gap-3", className)}>
      <Mark size={size} tone={tone} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Centred loader with a visible caption, for a block of content that is still loading. */
export function SectionLoader({ label = "Loading", size = 40, tone = "auto", className }: LoaderProps) {
  return (
    <div role="status" className={cn("flex flex-col items-center justify-center gap-3 py-10 text-sm text-muted-foreground", className)}>
      <Mark size={size} tone={tone} />
      <span className="kl-label">{label}</span>
    </div>
  );
}

/** Whole-screen loader (app boot, auth checks). 80px mark with a caption. */
export function FullScreenLoader({ label = "Loading your business", tone = "auto" }: { label?: string; tone?: LoaderTone }) {
  const onBrand = tone === "onBrand";
  return (
    <div
      role="status"
      className={cn(
        "flex min-h-screen flex-col items-center justify-center gap-4 text-sm",
        onBrand ? "bg-[#216AC7] text-white" : "bg-background text-muted-foreground",
      )}
    >
      <Mark size={80} tone={tone} />
      <span className="kl-label">{label}</span>
    </div>
  );
}

// Reads the pixel size a lucide icon would get from its tailwind classes (h-5, h-3.5, h-[18px]) or size prop.
function sizeFromProps(className: string | undefined, size: number | string | undefined): number {
  if (typeof size === "number") return size;
  if (typeof size === "string" && /^\d+$/.test(size)) return Number(size);
  const m = className?.match(/(?:^|\s)(?:h|size)-(\d+(?:\.\d+)?|\[(\d+)px\])(?=\s|$)/);
  if (m) return m[2] ? Number(m[2]) : Number(m[1]) * 4;
  return 16;
}

// Layout classes carry over to the mark; sizing, spin and colour classes are dropped because the
// mark brings its own.
function layoutClasses(className: string | undefined): string {
  return (className ?? "")
    .split(/\s+/)
    .filter((t) => t && !/^(?:h|w|size)-/.test(t) && t !== "animate-spin" && !/^(?:dark:)?text-/.test(t))
    .join(" ");
}

type SpinnerProps = Omit<React.ComponentProps<typeof PlainSpinner>, "ref"> & { tone?: LoaderTone };

/**
 * Drop-in for lucide's Loader2. 20px and up renders the Kowope mark; smaller sizes keep the plain
 * spinner. Decorative (aria-hidden): pair with visible text, or use Loader / SectionLoader.
 */
export function Spinner({ className, size, tone, ...rest }: SpinnerProps) {
  const px = sizeFromProps(className, size);
  if (px < 20) return <PlainSpinner className={cn("animate-spin", className)} size={size} {...rest} />;
  return <Mark size={px} tone={tone} className={layoutClasses(className)} />;
}

const REVEAL_KEY = "kowope.reveal.seen";

/** True until the reveal has played once in this browser session. */
export function useFirstLoad(): boolean {
  const [first] = useState(() => {
    try {
      return sessionStorage.getItem(REVEAL_KEY) !== "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try { sessionStorage.setItem(REVEAL_KEY, "1"); } catch { /* storage unavailable */ }
  }, []);
  return first;
}

/** Mark builds in the centre, glides left, then "kowope" and the strapline slide out. Plays once (4.2s). */
export function LogoReveal({ tone = "auto", className }: { tone?: LoaderTone; className?: string }) {
  const clipId = useId();
  return (
    <svg
      viewBox="0 0 560 180"
      className={cn("klr", className)}
      data-tone={tone === "auto" ? undefined : tone}
      role="img"
      aria-label="Kowope, run your business"
    >
      <g className="klr-t">
        <text x="150" y="102" fontFamily="'Instrument Sans', sans-serif" fontWeight="700" fontSize="76" letterSpacing="-2.3" className="klr-word">kowope</text>
        <text x="152" y="134" fontFamily="'Instrument Sans', sans-serif" fontWeight="600" fontSize="16" letterSpacing="2" className="klr-strap">RUN YOUR BUSINESS</text>
      </g>
      <g className="klr-m">
        <svg x="20" y="35" width="110" height="110" viewBox="0 0 24 24" overflow="visible" className="kl" data-tone={tone === "auto" ? undefined : tone}>
          <g className="klr-a">
            <path d={AWNING} className="kl-awning-fill" />
            <clipPath id={clipId}><path d={AWNING} /></clipPath>
            <rect x="9" y="2" width="6" height="12" className="kl-stripe" clipPath={`url(#${clipId})`} />
          </g>
          <rect className="klr-bd kl-body" x="4" y="12" width="16" height="9" rx="1.6" />
          <rect className="klr-b1 kl-bar" x="6.6" y="16.6" width="2.6" height="2.9" rx="0.5" />
          <rect className="klr-b2 kl-bar" x="10.7" y="15" width="2.6" height="4.5" rx="0.5" />
          <rect className="klr-b3 kl-bar" x="14.8" y="13.2" width="2.6" height="6.3" rx="0.5" />
        </svg>
      </g>
    </svg>
  );
}

/** Splash screen for the first load of a session: the logo reveal on brand blue. */
export function SplashScreen() {
  return (
    <div role="status" className="flex min-h-screen items-center justify-center bg-[#216AC7] px-6">
      <LogoReveal tone="onBrand" className="w-full max-w-md" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
