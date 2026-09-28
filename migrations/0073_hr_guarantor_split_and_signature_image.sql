-- 0073_hr_guarantor_split_and_signature_image.sql
--
-- Two corrections to the guarantor form (migration 0072), from product
-- feedback after the first pass:
--
--   1. The guarantor section must be filled by the actual guarantor, not
--      typed in second-hand by the employee. The form is now split into two
--      steps by two different people: the employee submits Employee + Next
--      of Kin data only ("awaiting_guarantor" status, was "pending_
--      signature" - renamed for clarity, same slot in the enum since the
--      column is free text with no DB constraint), then shares a link with
--      the actual guarantor, who fills the guarantor-* columns, the
--      eligibility checklist, and their own ID/photo - once, ever. See
--      GuarantorFormService.fillAndSign: it is the only code path that ever
--      writes guarantor_* columns, and it refuses to run a second time.
--
--   2. The signature is now a photographed/uploaded image of the
--      guarantor's actual signature, not a typed name - materially harder
--      to submit on someone else's behalf. typed_full_name is renamed
--      printed_full_name (still captured, but as a legible-name field next
--      to the image, not as the signature artifact itself).
--
-- No data migration: this feature has not yet had a real submission in
-- production (it shipped in the same release as 0072), so there is nothing
-- to backfill for the renamed/added columns.

ALTER TABLE hr_guarantor_form_signatures
  RENAME COLUMN typed_full_name TO printed_full_name;

ALTER TABLE hr_guarantor_form_signatures
  ADD COLUMN IF NOT EXISTS signature_image_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS signature_image_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS signature_image_size_bytes INTEGER;
