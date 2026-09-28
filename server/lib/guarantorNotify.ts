import { storage } from "../storage";
import { getAppUrl } from "./appUrl";
import { sendGuarantorSigningRequestEmail } from "../email";

/**
 * Fire-and-forget: emails the guarantor signing link to the address the
 * employee provided at initiate time (hr_guarantor_forms.guarantor_contact_
 * email). Called from both guarantor/initiate routes
 * (server/routes/hr.routes.ts, server/routes/profile-completion.routes.ts)
 * right after GuarantorFormService.initiate succeeds. Never throws - a
 * delivery failure must not undo or block the employee's own submission,
 * which is already committed by the time this runs. The employee can also
 * always copy/share the link manually (client/src/components/hr/GuarantorTab.tsx),
 * so this is a convenience, not the only path to the guarantor.
 */
export async function notifyGuarantorOfSigningLink(params: {
  staffId: string;
  guarantorContactEmail: string;
  guarantorFormId: string;
  signingToken: string;
}): Promise<void> {
  try {
    const staff = await storage.getStaff(params.staffId);
    if (!staff) return;
    const store = await storage.getStore(staff.storeId);
    if (!store) return;
    const business = await storage.getBusinessById(store.businessId);
    if (!business) return;

    const signingLink = `${getAppUrl()}/guarantor/sign?token=${encodeURIComponent(params.signingToken)}`;
    await sendGuarantorSigningRequestEmail(params.guarantorContactEmail, staff.name, business.name, signingLink);
  } catch (error) {
    console.error(`[GuarantorNotify] Failed to email signing link for form ${params.guarantorFormId}:`, error);
  }
}
