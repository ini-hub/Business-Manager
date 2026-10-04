const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export class MetaGraphError extends Error {}

async function graphGet<T = any>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(accessToken)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new MetaGraphError(body?.error?.message || `Meta API request to ${path} failed (${res.status}).`);
  }
  return body as T;
}

type DiscoveredPhoneNumber = {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string | null;
};

export type DiscoveredWaba = {
  wabaId: string;
  wabaName: string;
  businessName: string;
  phoneNumbers: DiscoveredPhoneNumber[];
};

/**
 * Given a system-user access token (the one thing an owner still has to
 * generate themselves - see the "How to get an access token" guidance in
 * whatsapp-number-settings.tsx), walks Meta's Graph API to discover every
 * WhatsApp number that token can see, so the owner picks their number from
 * a list instead of typing phone_number_id / waba_id by hand.
 *
 * Sequence (per Meta's WhatsApp Business Management API docs):
 *   GET /me/businesses -> businesses this token can act on
 *   GET /{business_id}/owned_whatsapp_business_accounts -> WABAs per business
 *   GET /{waba_id}/phone_numbers -> numbers per WABA
 *
 * Untested against a live Meta app as of writing (no test WABA available
 * yet) - built strictly to the documented shapes. If Meta's response shape
 * differs in practice, the fix is localized to this file.
 */
export async function discoverWhatsAppNumbers(accessToken: string): Promise<DiscoveredWaba[]> {
  const businesses = await graphGet<{ data: { id: string; name: string }[] }>("/me/businesses", accessToken);
  if (!businesses.data?.length) {
    throw new MetaGraphError("This token isn't linked to any Meta Business. Check it was generated for a system user assigned to your business.");
  }

  const results: DiscoveredWaba[] = [];

  for (const business of businesses.data) {
    const wabas = await graphGet<{ data: { id: string; name: string }[] }>(
      `/${business.id}/owned_whatsapp_business_accounts`,
      accessToken,
    ).catch(() => ({ data: [] }));

    for (const waba of wabas.data ?? []) {
      const numbers = await graphGet<{ data: { id: string; display_phone_number: string; verified_name: string; quality_rating?: string }[] }>(
        `/${waba.id}/phone_numbers`,
        accessToken,
      ).catch(() => ({ data: [] }));

      if (!numbers.data?.length) continue;

      results.push({
        wabaId: waba.id,
        wabaName: waba.name,
        businessName: business.name,
        phoneNumbers: numbers.data.map((n) => ({
          phoneNumberId: n.id,
          displayPhoneNumber: n.display_phone_number,
          verifiedName: n.verified_name,
          qualityRating: n.quality_rating ?? null,
        })),
      });
    }
  }

  if (results.length === 0) {
    throw new MetaGraphError("No WhatsApp numbers found for this token. Make sure a number has been added to your WhatsApp Business Account in Meta Business Suite.");
  }

  return results;
}
