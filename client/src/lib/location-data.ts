import { Country, State } from "country-state-city";
import { nigeriaLgasByStateCode } from "@shared/nigeria-lgas";

export interface LocationOption {
  value: string; // isoCode (country/state) or name (city/LGA - the package has no stable city code)
  label: string;
}

// Sorted once at module load - re-sorting a few hundred countries per
// render would be wasted work, and this list never changes at runtime.
export const countryOptions: LocationOption[] = Country.getAllCountries()
  .map((c) => ({ value: c.isoCode, label: c.name }))
  .sort((a, b) => a.label.localeCompare(b.label));

// Nationality reuses the same country list (label = country name, e.g.
// "Nigeria") rather than a separate demonym dataset ("Nigerian") - matches
// how most HR/KYC forms in practice ask "Nationality" with a country picker,
// and avoids maintaining a second 190-entry dataset that would need to stay
// in lockstep with this one.
export const nationalityOptions: LocationOption[] = countryOptions;

export function getStateOptions(countryIsoCode: string | undefined): LocationOption[] {
  if (!countryIsoCode) return [];
  return State.getStatesOfCountry(countryIsoCode)
    .map((s) => ({ value: s.isoCode, label: s.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// Nigeria's LGA list (shared/nigeria-lgas.ts) stands in for "city" there -
// LGA is the granularity Nigerian addresses actually use below State, and
// the country-state-city package has very sparse/inconsistent NG city data.
// Every other country falls through to the package's real city list.
//
// The package's city dataset (city.json) is ~8.5MB uncompressed - dynamically
// imported here so it only downloads for the (non-Nigerian) forms that
// actually need it, instead of bloating every bundle that touches location
// data.
export async function getCityOptions(countryIsoCode: string | undefined, stateIsoCode: string | undefined): Promise<LocationOption[]> {
  if (!countryIsoCode || !stateIsoCode) return [];
  if (countryIsoCode === "NG") {
    const lgas = nigeriaLgasByStateCode[stateIsoCode] ?? [];
    return lgas.map((name) => ({ value: name, label: name })).sort((a, b) => a.label.localeCompare(b.label));
  }
  const { City } = await import("country-state-city");
  return City.getCitiesOfState(countryIsoCode, stateIsoCode)
    .map((c) => ({ value: c.name, label: c.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function isNigeria(countryIsoCode: string | undefined): boolean {
  return countryIsoCode === "NG";
}

export function cityFieldLabel(countryIsoCode: string | undefined): string {
  return isNigeria(countryIsoCode) ? "Local Government Area (LGA)" : "City";
}
