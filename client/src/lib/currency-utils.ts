export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  locale: string;
}

export interface CountryInfo {
  code: string;
  name: string;
  currency: string;
  dialCode: string;
}

export const currencies: CurrencyInfo[] = [
  { code: "NGN", name: "Nigerian Naira", symbol: "₦", locale: "en-NG" },
  { code: "USD", name: "US Dollar", symbol: "$", locale: "en-US" },
  { code: "GBP", name: "British Pound", symbol: "£", locale: "en-GB" },
  { code: "EUR", name: "Euro", symbol: "€", locale: "en-EU" },
  { code: "GHS", name: "Ghanaian Cedi", symbol: "₵", locale: "en-GH" },
  { code: "KES", name: "Kenyan Shilling", symbol: "KSh", locale: "en-KE" },
  { code: "ZAR", name: "South African Rand", symbol: "R", locale: "en-ZA" },
  { code: "EGP", name: "Egyptian Pound", symbol: "E£", locale: "ar-EG" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ", locale: "ar-AE" },
  { code: "INR", name: "Indian Rupee", symbol: "₹", locale: "en-IN" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$", locale: "en-CA" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$", locale: "en-AU" },
];

export const countries: CountryInfo[] = [
  { code: "NG", name: "Nigeria", currency: "NGN", dialCode: "+234" },
  { code: "US", name: "United States", currency: "USD", dialCode: "+1" },
  { code: "GB", name: "United Kingdom", currency: "GBP", dialCode: "+44" },
  { code: "GH", name: "Ghana", currency: "GHS", dialCode: "+233" },
  { code: "KE", name: "Kenya", currency: "KES", dialCode: "+254" },
  { code: "ZA", name: "South Africa", currency: "ZAR", dialCode: "+27" },
  { code: "EG", name: "Egypt", currency: "EGP", dialCode: "+20" },
  { code: "AE", name: "United Arab Emirates", currency: "AED", dialCode: "+971" },
  { code: "IN", name: "India", currency: "INR", dialCode: "+91" },
  { code: "CA", name: "Canada", currency: "CAD", dialCode: "+1" },
  { code: "AU", name: "Australia", currency: "AUD", dialCode: "+61" },
  { code: "DE", name: "Germany", currency: "EUR", dialCode: "+49" },
  { code: "FR", name: "France", currency: "EUR", dialCode: "+33" },
].sort((a, b) => a.name.localeCompare(b.name));

export function getCurrencyByCode(code: string): CurrencyInfo | undefined {
  return currencies.find(c => c.code === code);
}

export function getCountryByCode(code: string): CountryInfo | undefined {
  return countries.find(c => c.code === code);
}

export function formatCurrency(value: number, currencyCode: string = "NGN"): string {
  const currency = getCurrencyByCode(currencyCode);
  const locale = currency?.locale || "en-US";
  
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
    }).format(value);
  } catch {
    return `${currencyCode} ${value.toFixed(2)}`;
  }
}

const USD_EXCHANGE_RATES: Record<string, number> = {
  NGN: 1500,
  GBP: 0.79,
  EUR: 0.92,
  GHS: 12.5,
  KES: 153,
  ZAR: 18.5,
  EGP: 31,
  AED: 3.67,
  INR: 83,
  CAD: 1.35,
  AUD: 1.52,
  USD: 1,
};

export function convertToUSD(value: number, fromCurrency: string): number {
  const rate = USD_EXCHANGE_RATES[fromCurrency] || 1;
  return value / rate;
}

export function formatDualCurrency(value: number, storeCurrency: string = "NGN"): { primary: string; secondary: string | null } {
  const primary = formatCurrency(value, storeCurrency);
  
  if (storeCurrency === "USD") {
    return { primary, secondary: null };
  }
  
  const usdValue = convertToUSD(value, storeCurrency);
  const secondary = formatCurrency(usdValue, "USD");
  
  return { primary, secondary };
}
