-- 0079_hr_guarantor_address_location.sql
--
-- Adds structured Country/State/LGA to each of the guarantor form's three
-- parties (employee, next of kin, guarantor) alongside the existing free-text
-- street address line. Previously "address" was the only address field at
-- all - no country/state/LGA breakdown - see shared/schema/hr-guarantor.ts
-- and client/src/components/location-select.tsx (Country -> State -> LGA
-- cascade, reused from the HR personal-fields work).
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "employee_address_country" text;
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "employee_address_state" text;
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "employee_address_city" text;
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "nok_address_country" text;
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "nok_address_state" text;
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "nok_address_city" text;
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "guarantor_address_country" text;
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "guarantor_address_state" text;
ALTER TABLE "hr_guarantor_form_versions" ADD COLUMN IF NOT EXISTS "guarantor_address_city" text;
