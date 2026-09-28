import type { HrFieldType, HrFieldValidation } from "./schema/hr-field-definitions";

export type HrFieldValueInput = string | number | boolean | string[] | null;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits only after stripping common punctuation - deliberately not
// country-aware (unlike shared/phone-utils.ts, built for the fixed staff
// mobileNumber field): the HR field builder is generic and a business may
// use it for any country's numbers, so admins configure min/max digit
// length themselves via HrFieldValidation instead of picking one country.
const PHONE_DIGITS_PATTERN = /^\d+$/;

export function isFieldValueEmpty(value: HrFieldValueInput): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Enforces a field's fieldType shape plus its admin-configured
 * HrFieldValidation rules (min/max length, numeric range, regex pattern) -
 * the Google-Forms-style "response validation" per question. Shared between
 * DynamicFieldForm.tsx (inline feedback before submit) and
 * HrPersonalProfileService.upsertValues (the actual enforcement point,
 * since client-side checks alone are never trustworthy) so the two can never
 * drift out of sync.
 */
export function validateHrFieldValue(
  fieldType: HrFieldType,
  value: HrFieldValueInput,
  validation: HrFieldValidation | null | undefined,
  label: string,
): { ok: true } | { ok: false; error: string } {
  if (isFieldValueEmpty(value)) return { ok: true }; // isRequired is checked separately

  switch (fieldType) {
    case "email": {
      if (typeof value !== "string" || !EMAIL_PATTERN.test(value.trim())) {
        return { ok: false, error: `${label} must be a valid email address` };
      }
      return { ok: true };
    }
    case "phone": {
      if (typeof value !== "string") return { ok: false, error: `${label} must be a valid phone number` };
      const digits = value.replace(/[\s\-()]/g, "").replace(/^\+/, "");
      if (!PHONE_DIGITS_PATTERN.test(digits)) {
        return { ok: false, error: `${label} must contain only digits` };
      }
      if (validation?.minLength !== undefined && digits.length < validation.minLength) {
        return { ok: false, error: `${label} must be at least ${validation.minLength} digits` };
      }
      if (validation?.maxLength !== undefined && digits.length > validation.maxLength) {
        return { ok: false, error: `${label} must be at most ${validation.maxLength} digits` };
      }
      return { ok: true };
    }
    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      if (typeof value === "boolean" || Array.isArray(value) || value === "" || Number.isNaN(num)) {
        return { ok: false, error: `${label} must be a number` };
      }
      if (validation?.integerOnly && !Number.isInteger(num)) {
        return { ok: false, error: `${label} must be a whole number` };
      }
      if (validation?.min !== undefined && num < validation.min) {
        return { ok: false, error: `${label} must be at least ${validation.min}` };
      }
      if (validation?.max !== undefined && num > validation.max) {
        return { ok: false, error: `${label} must be at most ${validation.max}` };
      }
      return { ok: true };
    }
    case "date": {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        return { ok: false, error: `${label} must be a valid date` };
      }
      return { ok: true };
    }
    case "text":
    case "textarea": {
      if (typeof value !== "string") return { ok: false, error: `${label} is invalid` };
      if (validation?.minLength !== undefined && value.length < validation.minLength) {
        return { ok: false, error: `${label} must be at least ${validation.minLength} characters` };
      }
      if (validation?.maxLength !== undefined && value.length > validation.maxLength) {
        return { ok: false, error: `${label} must be at most ${validation.maxLength} characters` };
      }
      if (validation?.pattern) {
        try {
          if (!new RegExp(validation.pattern).test(value)) {
            return { ok: false, error: validation.patternErrorMessage || `${label} is not in the expected format` };
          }
        } catch {
          // An invalid regex should have been rejected when the field was
          // configured (hrFieldValidationSchema's refine) - if one somehow
          // got stored anyway, skip enforcing it rather than 500ing on save.
        }
      }
      return { ok: true };
    }
    case "boolean":
    case "select":
      // select's value-in-options check is handled separately (it needs
      // the field's `options`, not `validation`), boolean has no format.
      return { ok: true };
    case "multiselect":
      return Array.isArray(value) ? { ok: true } : { ok: false, error: `${label} is invalid` };
    default:
      return { ok: true };
  }
}
