export interface CountryCode {
  code: string;
  name: string;
  dialCode: string;
  minLength: number;
  maxLength: number;
  pattern: RegExp;
}

export const countryCodes: CountryCode[] = [
  { code: "AU", name: "Australia", dialCode: "+61", minLength: 9, maxLength: 9, pattern: /^4\d{8}$/ },
  { code: "AT", name: "Austria", dialCode: "+43", minLength: 10, maxLength: 11, pattern: /^6\d{9,10}$/ },
  { code: "BD", name: "Bangladesh", dialCode: "+880", minLength: 10, maxLength: 10, pattern: /^1[3-9]\d{8}$/ },
  { code: "BE", name: "Belgium", dialCode: "+32", minLength: 9, maxLength: 9, pattern: /^4\d{8}$/ },
  { code: "BR", name: "Brazil", dialCode: "+55", minLength: 10, maxLength: 11, pattern: /^[1-9]\d{9,10}$/ },
  { code: "CA", name: "Canada", dialCode: "+1", minLength: 10, maxLength: 10, pattern: /^[2-9]\d{9}$/ },
  { code: "CN", name: "China", dialCode: "+86", minLength: 11, maxLength: 11, pattern: /^1[3-9]\d{9}$/ },
  { code: "CZ", name: "Czech Republic", dialCode: "+420", minLength: 9, maxLength: 9, pattern: /^[67]\d{8}$/ },
  { code: "DK", name: "Denmark", dialCode: "+45", minLength: 8, maxLength: 8, pattern: /^[2-9]\d{7}$/ },
  { code: "EG", name: "Egypt", dialCode: "+20", minLength: 10, maxLength: 10, pattern: /^1[0125]\d{8}$/ },
  { code: "FI", name: "Finland", dialCode: "+358", minLength: 9, maxLength: 10, pattern: /^4\d{8,9}$/ },
  { code: "FR", name: "France", dialCode: "+33", minLength: 9, maxLength: 9, pattern: /^[67]\d{8}$/ },
  { code: "DE", name: "Germany", dialCode: "+49", minLength: 10, maxLength: 12, pattern: /^1[567]\d{8,10}$/ },
  { code: "GH", name: "Ghana", dialCode: "+233", minLength: 9, maxLength: 10, pattern: /^[235]\d{8,9}$/ },
  { code: "GR", name: "Greece", dialCode: "+30", minLength: 10, maxLength: 10, pattern: /^69\d{8}$/ },
  { code: "HU", name: "Hungary", dialCode: "+36", minLength: 9, maxLength: 9, pattern: /^[2-9]\d{8}$/ },
  { code: "IN", name: "India", dialCode: "+91", minLength: 10, maxLength: 10, pattern: /^[6-9]\d{9}$/ },
  { code: "ID", name: "Indonesia", dialCode: "+62", minLength: 9, maxLength: 12, pattern: /^8\d{8,11}$/ },
  { code: "IE", name: "Ireland", dialCode: "+353", minLength: 9, maxLength: 9, pattern: /^8[35-9]\d{7}$/ },
  { code: "IT", name: "Italy", dialCode: "+39", minLength: 9, maxLength: 10, pattern: /^3\d{8,9}$/ },
  { code: "JP", name: "Japan", dialCode: "+81", minLength: 10, maxLength: 10, pattern: /^[789]0\d{8}$/ },
  { code: "KE", name: "Kenya", dialCode: "+254", minLength: 9, maxLength: 10, pattern: /^[17]\d{8,9}$/ },
  { code: "MY", name: "Malaysia", dialCode: "+60", minLength: 9, maxLength: 10, pattern: /^1\d{8,9}$/ },
  { code: "MX", name: "Mexico", dialCode: "+52", minLength: 10, maxLength: 10, pattern: /^[1-9]\d{9}$/ },
  { code: "NL", name: "Netherlands", dialCode: "+31", minLength: 9, maxLength: 9, pattern: /^6\d{8}$/ },
  { code: "NZ", name: "New Zealand", dialCode: "+64", minLength: 8, maxLength: 10, pattern: /^2\d{7,9}$/ },
  { code: "NG", name: "Nigeria", dialCode: "+234", minLength: 10, maxLength: 11, pattern: /^[789]\d{9,10}$/ },
  { code: "NO", name: "Norway", dialCode: "+47", minLength: 8, maxLength: 8, pattern: /^[49]\d{7}$/ },
  { code: "PK", name: "Pakistan", dialCode: "+92", minLength: 10, maxLength: 10, pattern: /^3\d{9}$/ },
  { code: "PH", name: "Philippines", dialCode: "+63", minLength: 10, maxLength: 10, pattern: /^9\d{9}$/ },
  { code: "PL", name: "Poland", dialCode: "+48", minLength: 9, maxLength: 9, pattern: /^[5-8]\d{8}$/ },
  { code: "PT", name: "Portugal", dialCode: "+351", minLength: 9, maxLength: 9, pattern: /^9[1-36]\d{7}$/ },
  { code: "RO", name: "Romania", dialCode: "+40", minLength: 9, maxLength: 9, pattern: /^7\d{8}$/ },
  { code: "RU", name: "Russia", dialCode: "+7", minLength: 10, maxLength: 10, pattern: /^9\d{9}$/ },
  { code: "SA", name: "Saudi Arabia", dialCode: "+966", minLength: 9, maxLength: 9, pattern: /^5\d{8}$/ },
  { code: "SG", name: "Singapore", dialCode: "+65", minLength: 8, maxLength: 8, pattern: /^[89]\d{7}$/ },
  { code: "ZA", name: "South Africa", dialCode: "+27", minLength: 9, maxLength: 9, pattern: /^[1-9]\d{8}$/ },
  { code: "ES", name: "Spain", dialCode: "+34", minLength: 9, maxLength: 9, pattern: /^[67]\d{8}$/ },
  { code: "SE", name: "Sweden", dialCode: "+46", minLength: 9, maxLength: 10, pattern: /^7\d{8,9}$/ },
  { code: "CH", name: "Switzerland", dialCode: "+41", minLength: 9, maxLength: 9, pattern: /^7[5-9]\d{7}$/ },
  { code: "TH", name: "Thailand", dialCode: "+66", minLength: 9, maxLength: 9, pattern: /^[689]\d{8}$/ },
  { code: "TR", name: "Turkey", dialCode: "+90", minLength: 10, maxLength: 10, pattern: /^5\d{9}$/ },
  { code: "UA", name: "Ukraine", dialCode: "+380", minLength: 9, maxLength: 9, pattern: /^[3-9]\d{8}$/ },
  { code: "AE", name: "United Arab Emirates", dialCode: "+971", minLength: 9, maxLength: 9, pattern: /^5\d{8}$/ },
  { code: "GB", name: "United Kingdom", dialCode: "+44", minLength: 10, maxLength: 11, pattern: /^[1-9]\d{9,10}$/ },
  { code: "US", name: "United States", dialCode: "+1", minLength: 10, maxLength: 10, pattern: /^[2-9]\d{9}$/ },
];

export function getCountryByCode(code: string): CountryCode | undefined {
  return countryCodes.find(c => c.code === code);
}

export function getCountryByDialCode(dialCode: string): CountryCode | undefined {
  return countryCodes.find(c => c.dialCode === dialCode);
}

export function validatePhoneNumber(phoneNumber: string, countryCodeOrDialCode: string): { valid: boolean; error?: string } {
  let country = getCountryByCode(countryCodeOrDialCode);
  if (!country) {
    country = getCountryByDialCode(countryCodeOrDialCode);
  }
  if (!country) {
    return { valid: false, error: "Invalid country code" };
  }

  const cleanedNumber = phoneNumber.replace(/[\s\-\(\)]/g, "").replace(/^0+/, "");
  
  if (!/^\d+$/.test(cleanedNumber)) {
    return { valid: false, error: "Phone number must contain only digits" };
  }

  if (cleanedNumber.length < country.minLength) {
    return { valid: false, error: `Phone number must be at least ${country.minLength} digits for ${country.name}` };
  }

  if (cleanedNumber.length > country.maxLength) {
    return { valid: false, error: `Phone number must be at most ${country.maxLength} digits for ${country.name}` };
  }

  return { valid: true };
}

export function formatPhoneDisplay(phoneNumber: string, countryCodeOrDialCode: string): string {
  let country = getCountryByCode(countryCodeOrDialCode);
  if (!country) {
    country = getCountryByDialCode(countryCodeOrDialCode);
  }
  const dialCode = country?.dialCode || countryCodeOrDialCode;
  return `${dialCode} ${phoneNumber}`;
}
