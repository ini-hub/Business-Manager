-- 0081_hr_guarantor_nok_relationship.sql
--
-- initiateGuarantorFormSchema has always required nextOfKin.relationship
-- ("Relationship *" on the employee-side form) but GuarantorFormService.initiate
-- never had a column to write it to - the value was validated, then silently
-- discarded. Adds the missing column so it's actually kept.
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "nok_relationship" text;
