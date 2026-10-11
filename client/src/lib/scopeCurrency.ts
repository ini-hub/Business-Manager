/**
 * The currency of the consolidated ("All stores") view the user is in, when the business has stores in
 * more than one currency. Held outside React so the fetch interceptor in main.tsx can attach it to every
 * API request; the server then scopes any "all stores" query to that currency, and money is never added
 * across currencies. Null in a single store, or when every store shares a currency.
 */
let scopeCurrency: string | null = null;

export const SCOPE_CURRENCY_HEADER = "x-scope-currency";

export function getScopeCurrency(): string | null {
  return scopeCurrency;
}

export function setScopeCurrency(code: string | null | undefined): void {
  scopeCurrency = code && /^[A-Za-z]{3}$/.test(code) ? code.toUpperCase() : null;
}
