import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SocialPlatform = "linkedin" | "x" | "instagram" | "facebook" | "tiktok";

const PLATFORM_CONFIG: Record<SocialPlatform, { label: string; placeholder: string; pattern: RegExp }> = {
  linkedin: { label: "LinkedIn", placeholder: "https://linkedin.com/in/janedoe", pattern: /^https?:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i },
  x: { label: "X (Twitter)", placeholder: "https://x.com/janedoe", pattern: /^https?:\/\/(x|twitter)\.com\/.+/i },
  instagram: { label: "Instagram", placeholder: "https://instagram.com/janedoe", pattern: /^https?:\/\/(www\.)?instagram\.com\/.+/i },
  facebook: { label: "Facebook", placeholder: "https://facebook.com/janedoe", pattern: /^https?:\/\/(www\.)?facebook\.com\/.+/i },
  tiktok: { label: "TikTok", placeholder: "https://tiktok.com/@janedoe", pattern: /^https?:\/\/(www\.)?tiktok\.com\/@.+/i },
};

/**
 * One reusable input per social platform, each with a placeholder showing
 * the expected link format (per the product ask: "LinkedIn, X, Instagram,
 * Facebook, TikTok should have a placeholder with format of expected
 * link") and inline feedback if what's typed doesn't look like that
 * platform's URL - matching HR fields "linkedin"/"x_handle"/"instagram"/
 * "facebook"/"tiktok" in server/lib/hrDefaults.ts.
 */
export function SocialUrlField({
  platform, value, onChange, error: externalError, disabled = false,
}: {
  platform: SocialPlatform;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  disabled?: boolean;
}) {
  const config = PLATFORM_CONFIG[platform];
  const formatError = value.trim() && !config.pattern.test(value.trim())
    ? `Expected a ${config.label} link, e.g. ${config.placeholder}`
    : undefined;
  const error = externalError ?? formatError;

  return (
    <div className="space-y-1.5">
      <Label>{config.label}</Label>
      <Input
        type="url"
        value={value}
        placeholder={config.placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(error && "border-destructive focus-visible:ring-destructive")}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function socialPlatformFromFieldKey(fieldKey: string): SocialPlatform | undefined {
  const map: Record<string, SocialPlatform> = { linkedin: "linkedin", x_handle: "x", instagram: "instagram", facebook: "facebook", tiktok: "tiktok" };
  return map[fieldKey];
}
