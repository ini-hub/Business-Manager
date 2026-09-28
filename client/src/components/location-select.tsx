import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/searchable-select";
import { countryOptions, nationalityOptions, getStateOptions, getCityOptions, cityFieldLabel, type LocationOption } from "@/lib/location-data";

/**
 * Reusable Country -> State -> City/LGA cascade: State options are re-derived
 * from the selected Country, and City options (LGA for Nigeria, city
 * everywhere else - see shared/nigeria-lgas.ts) from the selected State.
 * Fully controlled, like PhoneInput - the caller owns the three isoCode/name
 * strings and passes them back down, so this has no internal state of its
 * own to fall out of sync with a form's values.
 *
 * Selecting a new Country clears State+City, and a new State clears City,
 * since a previously chosen State/City is almost certainly invalid once its
 * parent changes - matches how Google Forms cascading sections behave.
 *
 * Each level is a SearchableSelect, not a plain Select - the country list
 * alone runs to ~195 entries and some states' city/LGA lists run to dozens,
 * both unusable to scan without search.
 */
export function LocationSelect({
  country, state, city,
  onCountryChange, onStateChange, onCityChange,
  countryLabel = "Country", stateLabel = "State", cityLabel,
  includeCity = true,
  disabled = false,
}: {
  country?: string; state?: string; city?: string;
  onCountryChange: (isoCode: string) => void;
  onStateChange: (isoCode: string) => void;
  onCityChange?: (name: string) => void;
  countryLabel?: string; stateLabel?: string; cityLabel?: string;
  includeCity?: boolean;
  disabled?: boolean;
}) {
  const stateOptions = getStateOptions(country);
  const resolvedCityLabel = cityLabel ?? cityFieldLabel(country);

  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    setCityOptions([]); // clear stale options from the previous country/state while the new list loads
    getCityOptions(country, state).then((options) => {
      if (!cancelled) setCityOptions(options);
    });
    return () => {
      cancelled = true;
    };
  }, [country, state]);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1.5">
        <Label>{countryLabel}</Label>
        <SearchableSelect
          options={countryOptions}
          value={country}
          onValueChange={(v) => {
            onCountryChange(v);
            onStateChange("");
            onCityChange?.("");
          }}
          placeholder="Select country"
          searchPlaceholder="Search countries..."
          emptyMessage="No country found."
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <Label>{stateLabel}</Label>
        <SearchableSelect
          options={stateOptions}
          value={state}
          onValueChange={(v) => {
            onStateChange(v);
            onCityChange?.("");
          }}
          placeholder={country ? "Select state" : "Select country first"}
          searchPlaceholder="Search states..."
          emptyMessage="No state found."
          disabled={disabled || !country || stateOptions.length === 0}
        />
      </div>

      {includeCity && (
        <div className="space-y-1.5">
          <Label>{resolvedCityLabel}</Label>
          <SearchableSelect
            options={cityOptions}
            value={city}
            onValueChange={(v) => onCityChange?.(v)}
            placeholder={state ? `Select ${resolvedCityLabel.toLowerCase()}` : "Select state first"}
            searchPlaceholder={`Search ${resolvedCityLabel.toLowerCase()}...`}
            emptyMessage={`No ${resolvedCityLabel.toLowerCase()} found.`}
            disabled={disabled || !state || cityOptions.length === 0}
          />
        </div>
      )}
    </div>
  );
}

/** Standalone nationality picker (Country dataset reused as-is - see the sibling comment in lib/location-data.ts). */
export function NationalitySelect({
  value, onChange, label = "Nationality", disabled = false,
}: { value?: string; onChange: (isoCode: string) => void; label?: string; disabled?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <SearchableSelect
        options={nationalityOptions}
        value={value}
        onValueChange={onChange}
        placeholder="Select nationality"
        searchPlaceholder="Search nationalities..."
        emptyMessage="No nationality found."
        disabled={disabled}
      />
    </div>
  );
}
