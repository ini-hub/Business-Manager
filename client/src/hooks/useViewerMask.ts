import { useStore } from "@/lib/store-context";

export const MASK_PLACEHOLDER = "••••";

/**
 * How the signed-in user's data is masked, as decided by the business owner (Settings >
 * Business profile > What staff can see). The server has already masked the values; this
 * tells screens to show placeholders instead of zeros and to turn off call/WhatsApp actions.
 */
export function useViewerMask(): { contact: boolean; figures: boolean } {
  const { business } = useStore();
  const m = (business as any)?.viewerMask;
  return { contact: !!m?.contact, figures: !!m?.figures };
}
