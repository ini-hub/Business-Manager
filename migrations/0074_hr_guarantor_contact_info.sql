-- 0074_hr_guarantor_contact_info.sql
--
-- Closes the delivery gap in the guarantor flow (migration 0073): the
-- employee previously only got a copyable link with no automatic delivery
-- channel. The employee now provides the guarantor's email at initiate
-- time (guarantor_contact_email, required; guarantor_contact_phone,
-- optional for a future WhatsApp/SMS channel) purely for routing the
-- signing link - this is NOT part of the guarantor's own immutable
-- submission on hr_guarantor_form_versions (that's still entered by the
-- guarantor themselves), so it lives on hr_guarantor_forms and can be
-- corrected on a re-initiate without touching any version row. See
-- GuarantorFormService.initiate and server/email.ts
-- sendGuarantorSigningRequestEmail.

ALTER TABLE hr_guarantor_forms
  ADD COLUMN IF NOT EXISTS guarantor_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS guarantor_contact_phone TEXT;
